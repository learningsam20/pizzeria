import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, Send, Bot, User, RefreshCw, Upload, FileText, CheckCircle2 } from 'lucide-react';
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
    { role: 'assistant', content: 'Hello! I am your Slice of Heaven digital assistant. Ask me anything about our pizzas, pricing, billing rules, or the status of your order!' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'knowledge'>('chat');
  
  // Knowledge Base admin state
  const [kbText, setKbText] = useState('');
  const [kbStatus, setKbStatus] = useState<{ exists: boolean; sizeBytes: number; updatedAt: string | null; snippet: string } | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Fetch current knowledge base status on load
  useEffect(() => {
    fetchKbStatus();
  }, []);

  const fetchKbStatus = async () => {
    try {
      const res = await fetch('/api/km-status');
      const data = await res.json();
      setKbStatus(data);
      if (data.exists) {
        // If it exists, fetch status snippet or we can load more if desired
      }
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
        setUploadStatus('✅ km.txt saved successfully!');
        fetchKbStatus();
      } else {
        setUploadStatus('❌ Failed: ' + data.error);
      }
    } catch (err: any) {
      setUploadStatus('❌ Error: ' + err.message);
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

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type === 'text/plain') {
      readAndUploadFile(file);
    } else {
      alert('Only plain text (.txt) files are supported for km.txt knowledge base.');
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const text = textToSend || input;
    if (!text.trim()) return;

    if (!textToSend) setInput('');
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setLoading(true);

    try {
      // Gather relevant client order/menu states to inject as real-time context
      const payload = {
        message: text,
        history: messages.slice(-10), // Pass last 10 messages for conversational context
        currentOrders: currentOrders.map(o => ({
          id: o.id,
          customer_name: o.customer_name,
          customer_phone: o.customer_phone,
          status: o.status,
          total_payable: o.total_payable,
          table_number: o.table_number,
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
        setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ Error: ${data.error || 'Failed to generate response'}` }]);
      }
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ Network Error: Could not reach chatbot server. Please confirm backend server is running. (${err.message})` }]);
    } finally {
      setLoading(false);
    }
  };

  const suggestionChips = [
    "What is the status of order #1?",
    "What bases can I select?",
    "Show me the pricing for Pepperoni pizza",
    "What is the cancellation refund policy?"
  ];

  return (
    <div className="flex flex-col h-[600px] border border-gray-200 rounded-2xl bg-white shadow-xl overflow-hidden" id="chatbot-container">
      {/* Header */}
      <div className="bg-gradient-to-r from-red-600 to-amber-500 text-white p-4 flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Bot className="w-8 h-8 p-1 bg-white/20 rounded-lg animate-pulse" id="bot-icon" />
          <div>
            <h3 className="font-semibold text-lg font-sans tracking-tight">Slice of Heaven AI Chat</h3>
            <p className="text-xs text-white/80 font-mono">Powered by Gemini 3.5 Flash</p>
          </div>
        </div>
        {isAdmin && (
          <div className="flex bg-white/20 p-0.5 rounded-lg text-xs font-medium">
            <button
              onClick={() => setActiveTab('chat')}
              className={`px-3 py-1 rounded-md transition-all ${activeTab === 'chat' ? 'bg-white text-red-600 shadow-sm' : 'text-white'}`}
              id="chat-tab-btn"
            >
              Chat
            </button>
            <button
              onClick={() => setActiveTab('knowledge')}
              className={`px-3 py-1 rounded-md transition-all ${activeTab === 'knowledge' ? 'bg-white text-red-600 shadow-sm' : 'text-white'}`}
              id="kb-tab-btn"
            >
              Knowledge Base (Admin)
            </button>
          </div>
        )}
      </div>

      {activeTab === 'chat' ? (
        <div className="flex-1 flex flex-col min-h-0 bg-gray-50">
          {/* Chat Window */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex items-start space-x-2.5 max-w-[85%] ${m.role === 'user' ? 'ml-auto flex-row-reverse space-x-reverse' : 'mr-auto'}`}
              >
                <div className={`p-2 rounded-xl flex-shrink-0 ${m.role === 'user' ? 'bg-amber-100 text-amber-700' : 'bg-red-50 text-red-600'}`}>
                  {m.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>
                <div
                  className={`p-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap font-sans ${
                    m.role === 'user' ? 'bg-amber-500 text-white shadow-md' : 'bg-white border border-gray-100 text-gray-800 shadow-sm'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            
            {loading && (
              <div className="flex items-start space-x-2.5 max-w-[85%] mr-auto">
                <div className="p-2 rounded-xl bg-red-50 text-red-600 animate-bounce">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="p-3 rounded-2xl text-sm bg-white border border-gray-100 text-gray-500 shadow-sm flex items-center space-x-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-red-500" />
                  <span>Gemini is thinking...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggestion Chips */}
          <div className="p-2 border-t border-gray-100 bg-white flex space-x-2 overflow-x-auto scrollbar-none">
            {suggestionChips.map((chip, idx) => (
              <button
                key={idx}
                onClick={() => handleSendMessage(chip)}
                className="whitespace-nowrap px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-xs text-gray-600 hover:text-gray-800 rounded-full font-sans transition-colors cursor-pointer"
                disabled={loading}
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Input Box */}
          <div className="p-3 border-t border-gray-200 bg-white flex space-x-2 items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Ask about pizzas, status of order, pricing..."
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all"
              id="chat-input"
              disabled={loading}
            />
            <button
              onClick={() => handleSendMessage()}
              className="p-2.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white rounded-xl transition-colors cursor-pointer"
              id="send-chat-btn"
              disabled={loading || !input.trim()}
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      ) : (
        /* Knowledge Base Management Panel */
        <div className="flex-1 overflow-y-auto p-6 bg-white space-y-6">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <div>
              <h4 className="font-semibold text-gray-800 text-base">Knowledge Management File (km.txt)</h4>
              <p className="text-xs text-gray-500">Provide the pricing, policy, and menu text context used directly by the AI chatbot.</p>
            </div>
            <button onClick={fetchKbStatus} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg" title="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {/* Current File Status */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 flex items-start space-x-3">
            <FileText className="w-8 h-8 text-amber-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-700">Status in Server: {kbStatus?.exists ? '✅ Loaded' : '⚠️ Missing (Using Default)'}</p>
              {kbStatus?.exists && (
                <div className="text-xs text-gray-500 space-y-1 mt-1 font-mono">
                  <p>File Size: {(kbStatus.sizeBytes / 1024).toFixed(2)} KB</p>
                  <p>Last Modified: {new Date(kbStatus.updatedAt || '').toLocaleString()}</p>
                </div>
              )}
              {kbStatus?.snippet && (
                <div className="mt-2.5 p-2 bg-white rounded border border-gray-100 text-xs font-mono text-gray-600 max-h-[80px] overflow-y-auto">
                  <strong>Content Snippet:</strong>
                  <p className="whitespace-pre-wrap">{kbStatus.snippet}</p>
                </div>
              )}
            </div>
          </div>

          {/* Paste or Upload Section */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">Upload new `km.txt` file</label>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${
                dragOver ? 'border-red-500 bg-red-50/50 scale-[0.99]' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
              <p className="text-xs font-medium text-gray-600 mb-1">Drag and drop your `km.txt` file here</p>
              <p className="text-[11px] text-gray-400 mb-3">Or click below to choose a file from your computer</p>
              <input
                type="file"
                accept=".txt"
                onChange={handleFileUpload}
                className="hidden"
                id="file-kb-upload"
              />
              <label
                htmlFor="file-kb-upload"
                className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-xs text-gray-700 rounded-lg cursor-pointer border border-gray-200 font-medium inline-block"
              >
                Select File
              </label>
            </div>
          </div>

          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">Or Paste Content Directly</label>
            <textarea
              rows={8}
              value={kbText}
              onChange={(e) => setKbText(e.target.value)}
              placeholder="Paste custom pricing, pizza toppings, rules, schedules, phone numbers..."
              className="w-full p-3 text-xs font-mono border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <div className="flex justify-between items-center">
              {uploadStatus && <span className="text-xs font-medium text-gray-600">{uploadStatus}</span>}
              <button
                onClick={() => handleUploadKb(kbText)}
                className="ml-auto px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-medium transition-colors cursor-pointer"
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
