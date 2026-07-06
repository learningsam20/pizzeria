import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  MessageSquare, Send, Bot, User, RefreshCw, Upload, FileText,
  Mic, Square, ShoppingBag, Volume2, VolumeX, Pizza
} from 'lucide-react';
import { MenuItem, OrderWithItems, AppSettings, DineInTable } from '../types';
import {
  createInitialVoiceOrderState,
  applyVoiceAction,
  formatCartSummary,
  parseLocalVoiceIntent,
  orderTotalsFromCombos,
  detectImpossibleRequest,
  mergeVoiceReplies,
  TYPE_IN_HINT,
  type VoiceOrderState,
  type VoiceAction,
} from '../lib/voiceOrderEngine';
import { useSpeechRecognition, speakText, isSpeechRecognitionSupported } from '../hooks/useSpeechRecognition';
import { formatMoney } from '../lib/appSettings';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatbotProps {
  currentOrders: OrderWithItems[];
  menuItems: MenuItem[];
  isAdmin: boolean;
  appSettings: AppSettings;
  staffLoggedIn: boolean;
  availableTables: DineInTable[];
  defaultTableName: string;
  onOrderPlaced: () => void;
}

export default function Chatbot({
  currentOrders,
  menuItems,
  isAdmin,
  appSettings,
  staffLoggedIn,
  availableTables,
  defaultTableName,
  onOrderPlaced,
}: ChatbotProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hello! I am your Slice of Heaven digital assistant. Ask me about pizzas, pricing, billing rules, or your order status.' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [topTab, setTopTab] = useState<'support' | 'voice'>('support');
  const [activeTab, setActiveTab] = useState<'chat' | 'knowledge'>('chat');

  const [voiceMessages, setVoiceMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Welcome to **voice ordering**! Use the **mic** for speech-to-text, or **type** for best accuracy.\n\nIf anything is unclear, I will ask you to type it in. I can only add items from our menu and place **dine-in** orders.\n\n1. **Show menu** · 2. Share **name + mobile** · 3. Add items · 4. **Place order**',
    },
  ]);
  const [voiceInput, setVoiceInput] = useState('');
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceOrderState>(() => createInitialVoiceOrderState(defaultTableName));
  const [speakReplies, setSpeakReplies] = useState(true);
  const [sessionStartedAt] = useState(() => new Date().toISOString());
  const voiceStateRef = useRef(voiceState);
  voiceStateRef.current = voiceState;

  const [kbText, setKbText] = useState('');
  const [kbStatus, setKbStatus] = useState<{ exists: boolean; sizeBytes: number; updatedAt: string | null; snippet: string } | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStartedAtChat, setSessionStartedAtChat] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const voiceEndRef = useRef<HTMLDivElement>(null);
  const topTabRef = useRef(topTab);
  topTabRef.current = topTab;
  const processVoiceRef = useRef<(text: string) => Promise<void>>(async () => {});
  const sendSupportRef = useRef<(text?: string) => Promise<void>>(async () => {});

  useEffect(() => {
    setVoiceState(prev => ({ ...prev, tableName: defaultTableName }));
  }, [defaultTableName]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    voiceEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [voiceMessages, voiceLoading]);

  useEffect(() => {
    fetchKbStatus();
    fetch('/api/chat/session', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      .then(r => r.json())
      .then(d => {
        setSessionId(d.sessionId);
        setSessionStartedAtChat(d.sessionStartedAt);
      })
      .catch(() => {});
  }, []);

  const processVoiceMessage = useCallback(async (text: string) => {
    if (!text.trim() || !staffLoggedIn) return;

    setVoiceMessages(prev => [...prev, { role: 'user', content: text }]);
    setVoiceLoading(true);

    const declined = detectImpossibleRequest(text);
    if (declined) {
      setVoiceMessages(prev => [...prev, { role: 'assistant', content: declined }]);
      speakText(declined, speakReplies);
      setVoiceInput('');
      setVoiceLoading(false);
      return;
    }

    const currentState = voiceStateRef.current;
    const cartSummary = formatCartSummary(currentState, menuItems, appSettings);
    const customerSummary = currentState.customer.verified
      ? `${currentState.customer.name}, ${currentState.customer.phone}${currentState.customer.email ? `, ${currentState.customer.email}` : ''}`
      : currentState.customer.name || currentState.customer.phone
        ? `partial: ${currentState.customer.name} ${currentState.customer.phone}`.trim()
        : 'not verified';

    let reply = '';
    let action: VoiceAction = { type: 'none', params: {} };

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'voice_order',
          message: text,
          sessionId,
          history: voiceMessages.slice(-8),
          cartSummary,
          customerSummary,
          currentMenuItems: menuItems.map(m => ({
            id: m.id,
            name: m.name,
            category: m.category,
            price_inr: m.price_inr,
          })),
          availableTables: availableTables.map(t => ({ table_name: t.table_name })),
        }),
      });

      const data = await res.json();
      if (res.ok && data.action) {
        reply = data.text || '';
        action = data.action as VoiceAction;
      } else {
        reply = data.error
          ? `${data.error} ${TYPE_IN_HINT}`
          : '';
      }
    } catch {
      reply = `I couldn't reach the assistant. Please type your order below. ${TYPE_IN_HINT}`;
    }

    if (action.type === 'none' && !reply) {
      const local = parseLocalVoiceIntent(text);
      if (local.type !== 'none') action = local;
    }

    const ctx = { menuItems, appSettings, availableTables, sessionStartedAt };
    let result;
    if (action.type === 'none') {
      result = {
        reply: mergeVoiceReplies('', reply, 'none', text),
        state: currentState,
        needsTypedInput: true,
      };
    } else {
      result = await applyVoiceAction(currentState, action, ctx);
      if (!result.reply) {
        result.reply = mergeVoiceReplies('', reply, action.type, text);
      }
    }

    setVoiceState(result.state);

    setVoiceMessages(prev => [...prev, { role: 'assistant', content: result.reply }]);
    speakText(result.reply, speakReplies);

    if (result.orderId) {
      onOrderPlaced();
    }

    setVoiceInput('');
    setVoiceLoading(false);
  }, [staffLoggedIn, menuItems, appSettings, availableTables, sessionStartedAt, voiceMessages, speakReplies, onOrderPlaced, sessionId]);

  processVoiceRef.current = processVoiceMessage;

  const reportSpeechError = useCallback((code: string) => {
    const messages: Record<string, string> = {
      'no-speech': "I didn't hear anything. Tap the mic and speak clearly, or type your message.",
      'not-allowed': 'Microphone access is blocked. Allow mic permission for this site in browser settings, then try again.',
      'service-not-allowed': 'Speech recognition is blocked in this browser. Open this app in Chrome or Edge (not the IDE preview).',
      'insecure-context': 'Voice input requires HTTPS or localhost.',
      'not-supported': 'Speech-to-text is not available in this browser. Use Chrome or Edge, or type your message.',
      'start-failed': 'Could not start the microphone. Wait a moment and tap the mic again.',
      network: 'Speech recognition needs an internet connection in Chrome/Edge.',
      'audio-capture': 'No microphone found, or it is in use by another app.',
    };
    const msg = `${messages[code] || `Voice input failed (${code.replace(/-/g, ' ')})`}. ${TYPE_IN_HINT}`;
    if (topTabRef.current === 'voice') {
      setVoiceMessages(prev => [...prev, { role: 'assistant', content: msg }]);
    } else {
      setMessages(prev => [...prev, { role: 'assistant', content: msg }]);
    }
  }, []);

  const handleSpeechFinal = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (topTabRef.current === 'voice') {
      setVoiceInput(trimmed);
      void processVoiceRef.current(trimmed);
    } else {
      setInput(trimmed);
      void sendSupportRef.current(trimmed);
    }
  }, []);

  const { isListening, interimTranscript, startListening, stopListening } =
    useSpeechRecognition({
      lang: 'en-IN',
      onInterim: (text) => {
        if (topTabRef.current === 'voice') setVoiceInput(text);
        else setInput(text);
      },
      onFinal: handleSpeechFinal,
      onError: reportSpeechError,
    });

  const toggleMic = () => {
    if (isListening) stopListening();
    else startListening();
  };

  const speechHint = isListening
    ? 'Stop recording'
    : isSpeechRecognitionSupported()
      ? 'Start voice input (browser speech-to-text)'
      : 'Voice input needs Chrome or Edge in a normal browser window';

  const fetchKbStatus = async () => {
    try {
      const res = await fetch('/api/km-status');
      const data = await res.json();
      setKbStatus(data);
    } catch (err) {
      console.error('Error fetching KB status:', err);
    }
  };

  const handleUploadKb = async (textToUpload: string) => {
    setUploadStatus('Uploading...');
    try {
      const res = await fetch('/api/km-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textToUpload })
      });
      const data = await res.json();
      if (data.success) {
        setUploadStatus('Knowledge base updated successfully!');
        fetchKbStatus();
      } else {
        setUploadStatus('Failed: ' + data.error);
      }
    } catch (err: unknown) {
      setUploadStatus('Error: ' + (err instanceof Error ? err.message : 'Upload failed'));
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readAndUploadFile(file);
  };

  const readAndUploadFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setKbText(text);
      handleUploadKb(text);
    };
    reader.readAsText(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type === 'text/plain') readAndUploadFile(file);
    else alert('Only plain text (.txt) files are supported for the knowledge base.');
  };

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend ?? input).trim();
    if (!text) return;
    if (loading && !textToSend) return;

    if (!textToSend) setInput('');
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setLoading(true);

    try {
      const payload = {
        message: text,
        sessionId,
        history: messages.slice(-10),
        currentOrders: currentOrders.map(o => ({
          id: o.id,
          customer_name: o.customer_name,
          customer_phone: o.customer_phone,
          status: o.status,
          total_payable: o.total_payable,
          table_name: o.table_name,
          created_at: o.created_at,
          items: o.items.map(i => ({ name: i.name, quantity: i.quantity }))
        })),
        currentMenuItems: menuItems.map(m => ({
          code: m.code,
          name: m.name,
          category: m.category,
          price_inr: m.price_inr
        }))
      };

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.text }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${data.error || 'Failed to generate response'}` }]);
      }
    } catch (err: unknown) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Network error: ${err instanceof Error ? err.message : 'Request failed'}` }]);
    } finally {
      setLoading(false);
    }
  };

  sendSupportRef.current = handleSendMessage;

  const handleVoiceSend = () => {
    const text = voiceInput.trim();
    if (!text) return;
    setVoiceInput('');
    processVoiceMessage(text);
  };

  const handleRemoveCombo = async (index: number) => {
    const result = await applyVoiceAction(
      voiceState,
      { type: 'remove_combo', params: { index: index + 1 } },
      { menuItems, appSettings, availableTables, sessionStartedAt }
    );
    setVoiceState(result.state);
    setVoiceMessages(prev => [...prev, { role: 'assistant', content: result.reply }]);
  };

  const handlePlaceOrderClick = () => processVoiceMessage('place order');

  const suggestionChips = [
    'What is the status of order #1?',
    'What bases can I select?',
    'Show me the pricing for Pepperoni pizza',
    'What is the cancellation refund policy?'
  ];

  const voiceChips = [
    'Show menu',
    'Add margherita on thin crust',
    'Show cart',
    'My name is Rahul, phone 9876543210',
    'Place order',
  ];

  const cartTotals = orderTotalsFromCombos(voiceState.combos, menuItems, appSettings);
  const headerSubtitle = topTab === 'voice'
    ? 'Voice ordering · mic or type'
    : `Support assistant${sessionStartedAtChat ? ` · Session ${new Date(sessionStartedAtChat).toLocaleTimeString()}` : ''}`;

  const renderMarkdown = (content: string) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        strong: ({ children }) => <strong className="font-bold text-noir-gold">{children}</strong>,
        em: ({ children }) => <em className="italic text-noir-muted">{children}</em>,
        code: ({ children }) => <code className="bg-noir-panel px-1 py-0.5 rounded text-[11px] font-mono">{children}</code>,
        h1: ({ children }) => <h3 className="font-serif italic text-noir-gold text-base mb-1">{children}</h3>,
        h2: ({ children }) => <h4 className="font-semibold text-noir-text mb-1">{children}</h4>,
        a: ({ href, children }) => <a href={href} className="text-noir-gold underline" target="_blank" rel="noreferrer">{children}</a>,
      }}
    >
      {content}
    </ReactMarkdown>
  );

  return (
    <div className="flex flex-col min-h-[640px] border border-noir-border rounded-2xl bg-noir-card shadow-xl overflow-hidden" id="chatbot-container">
      <div className="bg-noir-sidebar border-b border-noir-border p-4 flex flex-wrap justify-between items-center gap-3">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-noir-highlight rounded-xl border border-noir-gold-o20">
            <Bot className="w-6 h-6 text-noir-gold" id="bot-icon" />
          </div>
          <div>
            <h3 className="font-serif italic text-noir-gold text-base tracking-tight">Slice of Heaven Assistant</h3>
            <p className="text-[10px] text-noir-muted font-mono">{headerSubtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-noir-panel p-0.5 rounded-lg border border-noir-border text-xs font-semibold">
            <button
              onClick={() => setTopTab('support')}
              className={`px-3 py-1 rounded-md transition-all cursor-pointer flex items-center gap-1 ${topTab === 'support' ? 'bg-noir-gold text-black' : 'text-noir-muted hover:text-noir-text'}`}
              id="support-tab-btn"
            >
              <MessageSquare className="w-3 h-3" /> Support
            </button>
            <button
              onClick={() => setTopTab('voice')}
              className={`px-3 py-1 rounded-md transition-all cursor-pointer flex items-center gap-1 ${topTab === 'voice' ? 'bg-noir-gold text-black' : 'text-noir-muted hover:text-noir-text'}`}
              id="voice-order-tab-btn"
            >
              <Mic className="w-3 h-3" /> Voice Order
            </button>
          </div>
          {isAdmin && topTab === 'support' && (
            <div className="flex bg-noir-panel p-0.5 rounded-lg border border-noir-border text-xs font-semibold">
              <button
                onClick={() => setActiveTab('chat')}
                className={`px-3 py-1 rounded-md transition-all cursor-pointer ${activeTab === 'chat' ? 'bg-noir-highlight text-noir-gold border border-noir-gold-o20' : 'text-noir-muted hover:text-noir-text'}`}
                id="chat-tab-btn"
              >
                Chat
              </button>
              <button
                onClick={() => setActiveTab('knowledge')}
                className={`px-3 py-1 rounded-md transition-all cursor-pointer ${activeTab === 'knowledge' ? 'bg-noir-highlight text-noir-gold border border-noir-gold-o20' : 'text-noir-muted hover:text-noir-text'}`}
                id="kb-tab-btn"
              >
                Knowledge Base
              </button>
            </div>
          )}
        </div>
      </div>

      {topTab === 'voice' ? (
        !staffLoggedIn ? (
          <div className="flex-1 flex items-center justify-center p-8 bg-noir-panel text-center">
            <div className="max-w-sm space-y-3">
              <Pizza className="w-10 h-10 text-noir-gold mx-auto" />
              <p className="text-sm text-noir-muted">Staff must be signed in before customers can place orders. Ask staff to log in, then return here for voice ordering.</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col lg:flex-row min-h-0 bg-noir-panel">
            <div className="flex-1 flex flex-col min-h-[360px] lg:min-h-0 border-b lg:border-b-0 lg:border-r border-noir-border">
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {voiceMessages.map((m, idx) => (
                  <div
                    key={idx}
                    className={`flex items-start space-x-2.5 max-w-[90%] ${m.role === 'user' ? 'ml-auto flex-row-reverse space-x-reverse' : 'mr-auto'}`}
                  >
                    <div className={`p-2 rounded-xl flex-shrink-0 border ${m.role === 'user' ? 'bg-noir-gold/20 text-noir-gold border-noir-gold-o20' : 'bg-noir-highlight text-noir-gold border-noir-border'}`}>
                      {m.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                    </div>
                    <div className={`p-3 rounded-2xl text-sm leading-relaxed font-sans ${m.role === 'user' ? 'bg-noir-gold text-black shadow-md whitespace-pre-wrap' : 'bg-noir-card border border-noir-border text-noir-text shadow-sm chat-markdown'}`}>
                      {m.role === 'user' ? m.content : renderMarkdown(m.content)}
                    </div>
                  </div>
                ))}
                {voiceLoading && (
                  <div className="flex items-start space-x-2.5 mr-auto">
                    <div className="p-2 rounded-xl bg-noir-highlight text-noir-gold border border-noir-border">
                      <Bot className="w-4 h-4 animate-pulse" />
                    </div>
                    <div className="p-3 rounded-2xl text-sm bg-noir-card border border-noir-border text-noir-muted flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-noir-gold" />
                      <span>Processing…</span>
                    </div>
                  </div>
                )}
                {isListening && (
                  <p className="text-xs text-center text-red-300/90 font-mono animate-pulse py-1">
                    Listening… speak now (tap mic to stop)
                  </p>
                )}
                <div ref={voiceEndRef} />
              </div>

              <div className="p-2 border-t border-noir-border bg-noir-sidebar flex gap-2 overflow-x-auto">
                {voiceChips.map((chip, idx) => (
                  <button
                    key={idx}
                    onClick={() => processVoiceMessage(chip)}
                    className="whitespace-nowrap px-3 py-1.5 bg-noir-panel hover:bg-noir-highlight border border-noir-border text-[11px] text-noir-muted hover:text-noir-text rounded-full transition-colors cursor-pointer"
                    disabled={voiceLoading}
                  >
                    {chip}
                  </button>
                ))}
              </div>

              <div className="p-3 border-t border-noir-border bg-noir-card flex gap-2 items-center">
                <button
                  type="button"
                  onClick={toggleMic}
                  disabled={voiceLoading}
                  title={speechHint}
                  aria-pressed={isListening}
                  className={`p-2.5 rounded-xl border transition-colors cursor-pointer disabled:opacity-40 ${isListening ? 'bg-red-900/40 border-red-700 text-red-300 animate-pulse' : 'bg-noir-panel border-noir-border text-noir-gold hover:bg-noir-highlight'}`}
                  id="voice-mic-btn"
                >
                  {isListening ? <Square className="w-5 h-5 fill-current" /> : <Mic className="w-5 h-5" />}
                </button>
                <input
                  type="text"
                  value={voiceInput}
                  onChange={(e) => setVoiceInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleVoiceSend()}
                  placeholder={isListening ? 'Listening… speak your order' : 'Mic for speech-to-text, or type here'}
                  className="flex-1 px-4 py-2.5 bg-noir-panel border border-noir-border rounded-xl text-sm text-noir-text placeholder:text-noir-dim focus:outline-none focus:border-noir-gold"
                  id="voice-order-input"
                  disabled={voiceLoading}
                />
                <button
                  onClick={() => setSpeakReplies(v => !v)}
                  title={speakReplies ? 'Mute spoken replies' : 'Speak replies'}
                  className="p-2.5 bg-noir-panel border border-noir-border rounded-xl text-noir-muted hover:text-noir-gold cursor-pointer"
                >
                  {speakReplies ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
                </button>
                <button
                  onClick={handleVoiceSend}
                  disabled={voiceLoading || !voiceInput.trim()}
                  className="p-2.5 bg-noir-gold hover:bg-noir-gold-hover disabled:opacity-40 text-black rounded-xl cursor-pointer"
                  id="send-voice-btn"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>

            <aside className="w-full lg:w-80 flex flex-col bg-noir-card border-t lg:border-t-0 border-noir-border">
              <div className="p-4 border-b border-noir-border flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-noir-gold" />
                <h4 className="text-sm font-semibold text-noir-text">Your cart</h4>
                <span className="ml-auto text-[10px] font-mono text-noir-dim">{voiceState.tableName}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-[120px]">
                {!voiceState.combos.length ? (
                  <p className="text-xs text-noir-dim">Cart is empty.</p>
                ) : (
                  voiceState.combos.map((combo, idx) => {
                    const labels: string[] = [];
                    if (combo.baseId) {
                      const b = menuItems.find(m => m.id === combo.baseId);
                      if (b) labels.push(b.name);
                    }
                    Object.entries(combo.pizzas).forEach(([id, qty]) => {
                      const p = menuItems.find(m => m.id === Number(id));
                      if (p) labels.push(`${p.name} ×${qty}`);
                    });
                    Object.entries(combo.toppings).forEach(([id, qty]) => {
                      const t = menuItems.find(m => m.id === Number(id));
                      if (t) labels.push(`${t.name} ×${qty}`);
                    });
                    return (
                      <div key={combo.id} className="flex items-start gap-2 p-2 rounded-lg bg-noir-panel border border-noir-border text-xs">
                        <span className="flex-1 text-noir-text">{labels.join(', ') || 'Combo'}</span>
                        <button
                          onClick={() => handleRemoveCombo(idx)}
                          className="text-red-400 hover:text-red-300 shrink-0 cursor-pointer"
                          title="Remove"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="p-4 border-t border-noir-border space-y-2 text-xs">
                <div className="flex justify-between text-noir-muted">
                  <span>Subtotal</span>
                  <span>{formatMoney(cartTotals.subtotal, appSettings.default_currency)}</span>
                </div>
                {cartTotals.discount > 0 && (
                  <div className="flex justify-between text-green-400">
                    <span>Discount</span>
                    <span>−{formatMoney(cartTotals.discount, appSettings.default_currency)}</span>
                  </div>
                )}
                <div className="flex justify-between text-noir-muted">
                  <span>GST</span>
                  <span>{formatMoney(cartTotals.gst, appSettings.default_currency)}</span>
                </div>
                <div className="flex justify-between font-semibold text-noir-gold text-sm pt-1">
                  <span>Total</span>
                  <span>{formatMoney(cartTotals.total_payable, appSettings.default_currency)}</span>
                </div>
                <div className="pt-2 text-[10px] text-noir-dim">
                  {voiceState.customer.verified
                    ? `✓ ${voiceState.customer.name} · ${voiceState.customer.phone}`
                    : 'Verify with name + mobile in chat before placing order'}
                </div>
                <button
                  onClick={handlePlaceOrderClick}
                  disabled={voiceLoading || !voiceState.combos.length}
                  className="w-full py-2.5 mt-2 bg-noir-gold hover:bg-noir-gold-hover disabled:opacity-40 text-black font-semibold rounded-xl cursor-pointer text-xs"
                  id="voice-place-order-btn"
                >
                  Place order
                </button>
              </div>
            </aside>
          </div>
        )
      ) : activeTab === 'chat' ? (
        <div className="flex-1 flex flex-col min-h-0 bg-noir-panel">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex items-start space-x-2.5 max-w-[85%] ${m.role === 'user' ? 'ml-auto flex-row-reverse space-x-reverse' : 'mr-auto'}`}
              >
                <div className={`p-2 rounded-xl flex-shrink-0 border ${m.role === 'user' ? 'bg-noir-gold/20 text-noir-gold border-noir-gold-o20' : 'bg-noir-highlight text-noir-gold border-noir-border'}`}>
                  {m.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>
                <div
                  className={`p-3 rounded-2xl text-sm leading-relaxed font-sans ${
                    m.role === 'user'
                      ? 'bg-noir-gold text-black shadow-md whitespace-pre-wrap'
                      : 'bg-noir-card border border-noir-border text-noir-text shadow-sm chat-markdown'
                  }`}
                >
                  {m.role === 'user' ? m.content : renderMarkdown(m.content)}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex items-start space-x-2.5 max-w-[85%] mr-auto">
                <div className="p-2 rounded-xl bg-noir-highlight text-noir-gold border border-noir-border">
                  <Bot className="w-4 h-4 animate-pulse" />
                </div>
                <div className="p-3 rounded-2xl text-sm bg-noir-card border border-noir-border text-noir-muted shadow-sm flex items-center space-x-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-noir-gold" />
                  <span>Thinking...</span>
                </div>
              </div>
            )}
            {isListening && (
              <p className="text-xs text-center text-red-300/90 font-mono animate-pulse py-1 border-t border-noir-border bg-noir-sidebar">
                Listening… speak now (tap mic to stop)
              </p>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-2 border-t border-noir-border bg-noir-sidebar flex space-x-2 overflow-x-auto">
            {suggestionChips.map((chip, idx) => (
              <button
                key={idx}
                onClick={() => handleSendMessage(chip)}
                className="whitespace-nowrap px-3 py-1.5 bg-noir-panel hover:bg-noir-highlight border border-noir-border text-[11px] text-noir-muted hover:text-noir-text rounded-full transition-colors cursor-pointer"
                disabled={loading}
              >
                {chip}
              </button>
            ))}
          </div>

          <div className="p-3 border-t border-noir-border bg-noir-card flex space-x-2 items-center">
            <button
              type="button"
              onClick={toggleMic}
              disabled={loading}
              title={speechHint}
              aria-pressed={isListening}
              className={`p-2.5 rounded-xl border transition-colors cursor-pointer disabled:opacity-40 ${isListening ? 'bg-red-900/40 border-red-700 text-red-300 animate-pulse' : 'bg-noir-panel border-noir-border text-noir-gold hover:bg-noir-highlight'}`}
              id="support-mic-btn"
            >
              {isListening ? <Square className="w-5 h-5 fill-current" /> : <Mic className="w-5 h-5" />}
            </button>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder={isListening ? 'Listening…' : 'Mic for speech-to-text, or type your question'}
              className="flex-1 px-4 py-2.5 bg-noir-panel border border-noir-border rounded-xl text-sm text-noir-text placeholder:text-noir-dim focus:outline-none focus:border-noir-gold transition-all"
              id="chat-input"
              disabled={loading}
            />
            <button
              onClick={() => handleSendMessage()}
              aria-label="Send chat message"
              title="Send chat message"
              className="p-2.5 bg-noir-gold hover:bg-noir-gold-hover disabled:opacity-40 text-black rounded-xl transition-colors cursor-pointer"
              id="send-chat-btn"
              disabled={loading || !input.trim()}
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-6 bg-noir-panel space-y-6">
          <div className="flex items-center justify-between border-b border-noir-border pb-3">
            <div>
              <h4 className="font-serif italic text-noir-gold text-base">Help knowledge base</h4>
              <p className="text-xs text-noir-muted mt-1">
                Answers are based on the App Help guide. Uploads here override the guide until the next app restart.
              </p>
            </div>
            <button onClick={fetchKbStatus} className="p-1.5 text-noir-dim hover:text-noir-gold hover:bg-noir-highlight rounded-lg border border-noir-border" title="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          <div className="bg-noir-card rounded-xl p-4 border border-noir-border flex items-start space-x-3">
            <FileText className="w-8 h-8 text-noir-gold flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-noir-text">Server status: {kbStatus?.exists ? 'Loaded' : 'Missing (using default)'}</p>
              {kbStatus?.exists && (
                <div className="text-xs text-noir-muted space-y-1 mt-1 font-mono">
                  <p>Size: {(kbStatus.sizeBytes / 1024).toFixed(2)} KB</p>
                  <p>Modified: {new Date(kbStatus.updatedAt || '').toLocaleString()}</p>
                </div>
              )}
              {kbStatus?.snippet && (
                <div className="mt-2.5 p-2 bg-noir-panel rounded border border-noir-border text-xs font-mono text-noir-muted max-h-[80px] overflow-y-auto whitespace-pre-wrap">
                  {kbStatus.snippet}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <label className="block text-sm font-medium text-noir-text">Override knowledge base (optional)</label>
            <p className="text-[10px] text-noir-dim">Temporary uploads are replaced when the app restarts and the help guide is reloaded.</p>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${
                dragOver ? 'border-noir-gold bg-noir-highlight/50' : 'border-noir-border hover:border-noir-gold-o20 bg-noir-card'
              }`}
            >
              <Upload className="w-8 h-8 text-noir-dim mx-auto mb-2" />
              <p className="text-xs font-medium text-noir-muted mb-3">Drag & drop a .txt file or choose a file</p>
              <input type="file" accept=".txt" onChange={handleFileUpload} className="hidden" id="file-kb-upload" />
              <label htmlFor="file-kb-upload" className="px-3.5 py-1.5 bg-noir-highlight hover:bg-noir-sidebar text-xs text-noir-gold rounded-lg cursor-pointer border border-noir-gold-o20 font-medium inline-block">
                Select File
              </label>
            </div>
          </div>

          <div className="space-y-3">
            <label className="block text-sm font-medium text-noir-text">Or paste content</label>
            <textarea
              rows={8}
              value={kbText}
              onChange={(e) => setKbText(e.target.value)}
              placeholder="Paste custom pricing, toppings, rules..."
              className="w-full p-3 text-xs font-mono bg-noir-card border border-noir-border rounded-xl text-noir-text focus:outline-none focus:border-noir-gold"
            />
            <div className="flex justify-between items-center">
              {uploadStatus && <span className="text-xs text-noir-muted">{uploadStatus}</span>}
              <button
                onClick={() => handleUploadKb(kbText)}
                className="ml-auto px-4 py-2 bg-noir-gold hover:bg-noir-gold-hover text-black rounded-xl text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40"
                disabled={!kbText.trim()}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
