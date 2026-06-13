import { useEffect, useState, useRef, useCallback } from 'react';
import { Paperclip, Send, Download, AlertTriangle, X, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiCall } from '../utils/api';
import { detectContactInfo } from '../utils/contactDetector';
import { useToast } from './Toast';

const S = {
  wrap: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 },
  banner: { background: '#1e3a4a', border: '1px solid #0e8a7d', borderRadius: 10, padding: '10px 14px', marginBottom: 10, display: 'flex', alignItems: 'flex-start', gap: 10 },
  bannerText: { color: '#94a3b8', fontSize: '0.88rem', lineHeight: 1.5 },
  messagesArea: { flex: 1, overflowY: 'auto', padding: '12px 0', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 },
  ownBubble:   { alignSelf: 'flex-end',  maxWidth: '70%', background: '#0d2620', border: '1px solid #0e8a7d', borderRadius: '14px 14px 4px 14px',  padding: '9px 13px' },
  otherBubble: { alignSelf: 'flex-start', maxWidth: '70%', background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: '14px 14px 14px 4px', padding: '9px 13px' },
  senderName: { color: '#14a89a', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 },
  msgText:    { color: '#e2e8f0', fontSize: '0.9rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  msgTime:    { color: '#64748b', fontSize: '0.7rem', marginTop: 4, textAlign: 'right' },
  contactFlag: { display: 'inline-flex', alignItems: 'center', gap: 4, color: '#f59e0b', fontSize: '0.7rem', marginTop: 4 },
  attRow: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, padding: '5px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: 6 },
  attName: { color: '#94a3b8', fontSize: '0.78rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  dlBtn: { background: 'none', border: 'none', color: '#14a89a', cursor: 'pointer', padding: '2px 4px', flexShrink: 0 },
  inputArea: { borderTop: '1px solid #1e3a4a', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 },
  filesPreview: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  fileChip: { display: 'flex', alignItems: 'center', gap: 5, background: '#1e3a4a', borderRadius: 6, padding: '3px 8px', fontSize: '0.78rem', color: '#94a3b8' },
  fileChipX: { background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 0, display: 'flex' },
  inputRow: { display: 'flex', gap: 8, alignItems: 'flex-end' },
  textarea: { flex: 1, background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 10, padding: '10px 12px', color: '#e2e8f0', fontSize: '0.9rem', resize: 'none', lineHeight: 1.5, minHeight: 42, maxHeight: 120, boxSizing: 'border-box' },
  attachBtn: { background: '#1e3a4a', border: 'none', borderRadius: 8, padding: '10px', cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center', flexShrink: 0 },
  sendBtn: (disabled) => ({ background: disabled ? '#1e3a4a' : '#14a89a', border: 'none', borderRadius: 8, padding: '10px 14px', cursor: disabled ? 'default' : 'pointer', color: disabled ? '#64748b' : '#fff', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600, flexShrink: 0, fontSize: '0.88rem' }),
  sendErr: { color: '#f87171', fontSize: '0.82rem' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal:  { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 14, padding: '2rem', maxWidth: 420, width: '90%' },
  modalTitle: { color: '#e2e8f0', fontWeight: 700, fontSize: '1.05rem', marginBottom: 8 },
  modalText:  { color: '#94a3b8', fontSize: '0.88rem', lineHeight: 1.6, marginBottom: '1.5rem' },
  modalBtns: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
  cancelBtn: { background: 'none', border: '1px solid #334155', borderRadius: 8, padding: '8px 16px', color: '#94a3b8', cursor: 'pointer' },
  okBtn:     { background: '#f59e0b', border: 'none', borderRadius: 8, padding: '8px 16px', color: '#1a2332', fontWeight: 700, cursor: 'pointer' },
  readonlyBanner: { textAlign: 'center', padding: '10px', color: '#64748b', fontSize: '0.82rem', borderTop: '1px solid #1e3a4a' },
};

/**
 * Reusable chat window.
 * Props:
 *   conversationId  — required
 *   readOnly        — show messages only, no input (default false)
 *   scheduledBanner — show "contacts allowed" info banner (default false)
 *   checkContacts   — warn on contact info detection (default false)
 *   pollInterval    — ms between message polls (default 5000)
 */
export default function ChatWindow({
  conversationId,
  readOnly = false,
  scheduledBanner = false,
  checkContacts = false,
  pollInterval = 5000,
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading]   = useState(true);

  const [text, setText]           = useState('');
  const [files, setFiles]         = useState([]);
  const [sending, setSending]     = useState(false);
  const [sendError, setSendError] = useState('');
  const [showWarning, setShowWarning] = useState(false);

  const bottomRef    = useRef(null);
  const fileInputRef = useRef(null);
  const atBottomRef  = useRef(true);

  const loadMessages = useCallback(async () => {
    if (!conversationId) return;
    try {
      const data = await apiCall('GET', `/conversations/${conversationId}/messages?limit=100`);
      setMessages(data ?? []);
    } catch {}
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    setLoading(true);
    loadMessages().finally(() => setLoading(false));
  }, [conversationId, loadMessages]);

  useEffect(() => {
    if (!conversationId) return;
    const t = setInterval(loadMessages, pollInterval);
    return () => clearInterval(t);
  }, [conversationId, loadMessages, pollInterval]);

  useEffect(() => {
    if (atBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  function handleScroll(e) {
    const el = e.currentTarget;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }

  function handleFileChange(e) {
    const chosen = Array.from(e.target.files ?? []);
    setFiles(prev => [...prev, ...chosen].slice(0, 5));
    e.target.value = '';
  }

  function handleSendClick() {
    if (!text.trim() && files.length === 0) return;
    if (checkContacts && text.trim() && detectContactInfo(text)) {
      setShowWarning(true);
      return;
    }
    doSend();
  }

  async function doSend() {
    setShowWarning(false);
    setSending(true);
    setSendError('');
    try {
      const form = new FormData();
      form.append('content', text || ' ');
      for (const f of files) form.append('files', f);
      await apiCall('POST', `/conversations/${conversationId}/messages`, form);
      setText('');
      setFiles([]);
      atBottomRef.current = true;
      await loadMessages();
    } catch (e) {
      setSendError(e.message);
    } finally {
      setSending(false);
    }
  }

  async function handleDownload(msg, att) {
    try {
      const { url } = await apiCall('GET', `/conversations/${conversationId}/messages/${msg.id}/attachments/${att.id}/download`);
      window.open(url, '_blank');
    } catch (e) {
      toast?.error(e.message);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendClick();
    }
  }

  if (!conversationId) return <div style={{ color: '#64748b', padding: '2rem', textAlign: 'center' }}>Чат не найден</div>;
  if (loading) return <div style={{ color: '#64748b', padding: '1rem' }}>Загрузка чата...</div>;

  return (
    <div style={S.wrap}>
      {scheduledBanner && (
        <div style={S.banner}>
          <Info size={16} style={{ color: '#14a89a', flexShrink: 0, marginTop: 1 }} />
          <div style={S.bannerText}>
            Для согласования времени и места вы можете обменяться контактами. Переписка проверяется модератором.
          </div>
        </div>
      )}

      <div style={S.messagesArea} onScroll={handleScroll}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: '#64748b', padding: '2rem', fontSize: '0.9rem' }}>
            Сообщений пока нет
          </div>
        )}
        {messages.map(msg => {
          const isOwn = msg.sender_id === user?.id;
          return (
            <div key={msg.id} style={isOwn ? S.ownBubble : S.otherBubble}>
              {!isOwn && <div style={S.senderName}>{msg.sender?.nickname ?? 'Пользователь'}</div>}
              <div style={S.msgText}>{msg.content}</div>
              {msg.message_attachments?.map(att => (
                <div key={att.id} style={S.attRow}>
                  <span style={S.attName}>{att.file_name}</span>
                  <span style={{ color: '#64748b', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
                    {(att.file_size / 1024).toFixed(0)} КБ
                  </span>
                  <button style={S.dlBtn} onClick={() => handleDownload(msg, att)}><Download size={13} /></button>
                </div>
              ))}
              {msg.is_contact_info && (
                <div style={S.contactFlag}>
                  <AlertTriangle size={11} />
                  {scheduledBanner ? 'Контактные данные — проверяется модератором' : 'Обнаружены контактные данные'}
                </div>
              )}
              <div style={S.msgTime}>
                {new Date(msg.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                {' '}
                {new Date(msg.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {readOnly ? (
        <div style={S.readonlyBanner}>Просмотр переписки — только чтение</div>
      ) : (
        <div style={S.inputArea}>
          {files.length > 0 && (
            <div style={S.filesPreview}>
              {files.map((f, i) => (
                <div key={i} style={S.fileChip}>
                  {f.name.length > 20 ? f.name.slice(0, 18) + '…' : f.name}
                  <button style={S.fileChipX} onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}>
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div style={S.inputRow}>
            <input type="file" multiple ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileChange} />
            <button style={S.attachBtn} onClick={() => fileInputRef.current?.click()} title="Прикрепить файл">
              <Paperclip size={16} />
            </button>
            <textarea
              style={S.textarea}
              placeholder="Напишите сообщение... (Enter — отправить, Shift+Enter — перенос)"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
            />
            <button
              style={S.sendBtn(sending || (!text.trim() && files.length === 0))}
              onClick={handleSendClick}
              disabled={sending || (!text.trim() && files.length === 0)}
            >
              <Send size={15} />
              {sending ? '...' : 'Отправить'}
            </button>
          </div>
          {sendError && (
            <div style={S.sendErr}>
              {sendError}
              {sendError.includes('заблокирован') && (
                <> · <Link to="/support" style={{ color: '#14a89a' }}>Написать в поддержку</Link></>
              )}
            </div>
          )}
        </div>
      )}

      {showWarning && (
        <div style={S.overlay} onClick={() => setShowWarning(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <AlertTriangle size={20} style={{ color: '#f59e0b' }} />
              <div style={S.modalTitle}>Обмен контактами</div>
            </div>
            <div style={S.modalText}>
              Обмен контактами для этого типа заказа не предусмотрен. Сообщение будет проверено модератором. Отправить всё равно?
            </div>
            <div style={S.modalBtns}>
              <button style={S.cancelBtn} onClick={() => setShowWarning(false)}>Изменить</button>
              <button style={S.okBtn} onClick={doSend}>Отправить всё равно</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
