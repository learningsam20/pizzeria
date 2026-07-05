import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MessageSquare, Send, Bot, User, RefreshCw, Upload, FileText } from 'lucide-react';
import { MenuItem, OrderWithItems } from '../types';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatbotProps {
  currentOrders: OrderWithItems[];
  menuItems: MenuItem[];
  isAdmin: boolean;
}

export default function Chatbot({ currentOrders, menuItems, isAdmin }: ChatbotProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hello! I am your Slice of Heaven digital assistant. Ask me about pizzas, pricing, billing rules, or your order status.' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'knowledge'>('chat');

  const [kbText, setKbText] = useState('');
  const [kbStatus, setKbStatus] = useState<{ exists: boolean; sizeBytes: number; updatedAt: string | null; snippet: string } | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    fetchKbStatus();
    fetch('/api/chat/session', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      .then(r => r.json())
      .then(d => {
        setSessionId(d.sessionId);
        setSessionStartedAt(d.sessionStartedAt);
      })
      .catch(() => {});
  }, []);

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
    } catch (err: any) {
      setUploadStatus('Error: ' + err.message);
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
    const text = textToSend || input;
    if (!text.trim()) return;

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
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Network error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  const suggestionChips = [
    'What is the status of order #1?',
    'What bases can I select?',
    'Show me the pricing for Pepperoni pizza',
    'What is the cancellation refund policy?'
  ];

  return (
    <div className="flex flex-col h-[600px] border border-noir-border rounded-2xl bg-noir-card shadow-xl overflow-hidden" id="chatbot-container">
      <div className="bg-noir-sidebar border-b border-noir-border p-4 flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-noir-highlight rounded-xl border border-noir-gold-o20">
            <Bot className="w-6 h-6 text-noir-gold" id="bot-icon" />
          </div>
          <div>
            <h3 className="font-serif italic text-noir-gold text-base tracking-tight">Slice of Heaven Support</h3>
            <p className="text-[10px] text-noir-muted font-mono">
              Support assistant{sessionStartedAt ? ` · Session ${new Date(sessionStartedAt).toLocaleTimeString()}` : ''}
            </p>
          </div>
        </div>
        {isAdmin && (
          <div className="flex bg-noir-panel p-0.5 rounded-lg border border-noir-border text-xs font-semibold">
            <button
              onClick={() => setActiveTab('chat')}
              className={`px-3 py-1 rounded-md transition-all cursor-pointer ${activeTab === 'chat' ? 'bg-noir-gold text-black' : 'text-noir-muted hover:text-noir-text'}`}
              id="chat-tab-btn"
            >
              Chat
            </button>
            <button
              onClick={() => setActiveTab('knowledge')}
              className={`px-3 py-1 rounded-md transition-all cursor-pointer ${activeTab === 'knowledge' ? 'bg-noir-gold text-black' : 'text-noir-muted hover:text-noir-text'}`}
              id="kb-tab-btn"
            >
              Knowledge Base
            </button>
          </div>
        )}
      </div>

      {activeTab === 'chat' ? (
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
                  {m.role === 'user' ? m.content : (
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
                      {m.content}
                    </ReactMarkdown>
                  )}
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
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Ask about pizzas, order status, pricing..."
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
