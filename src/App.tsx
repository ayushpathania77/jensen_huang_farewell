import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { photos, type Photograph } from './lib/photos';
import { useTribute } from './hooks/useTribute';
import { useMessages } from './hooks/useMessages';
import { PhotoPuzzle, YearQuiz } from './components/PhotoGames';
import './styles.css';

type Mode = 'explore' | 'puzzle' | 'year';
type MobilePane = 'photos' | 'wall';
const modes: { id: Mode; label: string }[] = [
  { id: 'explore', label: 'Explore' },
  { id: 'puzzle', label: 'Photo puzzle' },
  { id: 'year', label: 'Guess the year' },
];
const numberFormat = new Intl.NumberFormat('en');
const initialPhotoIndex = Math.max(0, photos.findIndex((photo) => photo.id === 'stanford-conversation-010'));
const announcementUrl = 'https://nvidianews.nvidia.com/news/nvidia-announces-ceo-transition';
const motionBehavior = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' as const : 'smooth' as const;
const limitText = (value: string, limit: number) => Array.from(value).slice(0, limit).join('');

function Arrow({ direction = 'right' }: { direction?: 'right' | 'left' | 'up-right' }) {
  return <svg className={`arrow-icon arrow-${direction}`} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={direction === 'up-right' ? 'M6 18 18 6M6 6h12v12' : 'M4 12h15m-6-6 6 6-6 6'} /></svg>;
}

function AlbumMark() {
  return <svg className="album-mark" viewBox="0 0 38 38" fill="none" aria-hidden="true"><path d="M3.5 4.5h13v13h-13zm18 0h13v13h-13zm-18 18h13v13h-13z" fill="currentColor" /><path d="M21.5 22.5h13v13h-13z" stroke="currentColor" /></svg>;
}

function ModeIcon({ mode }: { mode: Mode }) {
  return <svg className="mode-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">{mode === 'explore' ? <><rect x="2.5" y="3" width="15" height="14" /><path d="m3 14 4-4 3 3 3-5 4 6" /><circle cx="7" cy="7" r="1" /></> : mode === 'puzzle' ? <path d="M3 3h5v5H3zm9 0h5v5h-5zM3 12h5v5H3zm9 0h5v5h-5z" /> : <><circle cx="10" cy="10" r="7.5" /><path d="M7.5 7a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 2.5v.5" /></>}</svg>;
}

function PhotographCredit({ photo, hideYear = false }: { photo: Photograph; hideYear?: boolean }) {
  return <div className="photograph-credit"><span>Photo: <a href={photo.sourceUrl} target="_blank" rel="noreferrer">{photo.creator}</a></span><span aria-hidden="true">·</span><a href={photo.licenseUrl || photo.sourceUrl} target="_blank" rel="noreferrer">{photo.license}</a><details className="photo-source-details"><summary>Details</summary><div className="photo-source-popover"><strong>{hideYear ? 'Original photograph' : photo.caption}</strong><p>{photo.changes || 'Resized for the web. Explore mode shows the complete photograph.'}</p><a href={photo.sourceUrl} target="_blank" rel="noreferrer">View the original photograph <Arrow direction="up-right" /></a></div></details></div>;
}

function messageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export default function App() {
  const { stats, phase, error: presenceError, stale, join, retry: retryPresence } = useTribute();
  const { messages, totalMessages, loading, sending, error: messageError, sendMessage, refresh } = useMessages();
  const [mode, setMode] = useState<Mode>('explore');
  const [mobilePane, setMobilePane] = useState<MobilePane>('photos');
  const [selectedIndex, setSelectedIndex] = useState(initialPhotoIndex);
  const [restored, setRestored] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [formFeedback, setFormFeedback] = useState('');
  const [shareFeedback, setShareFeedback] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const stripRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const thumbnails = useRef<(HTMLButtonElement | null)[]>([]);
  const modeButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const sendingRef = useRef(false);
  const photo = photos[selectedIndex] ?? photos[0];
  const sortedMessages = useMemo(() => [...messages].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 30), [messages]);
  const latestMessage = sortedMessages[0];
  const participated = Boolean(stats?.participated || phase === 'joined');
  const presenceReady = Boolean(stats) && phase !== 'initializing';
  const wallCount = loading ? '…' : messageError && !messages.length ? '—' : numberFormat.format(totalMessages);

  useEffect(() => { if (formFeedback) noteRef.current?.focus({ preventScroll: true }); }, [formFeedback]);

  useEffect(() => {
    const strip = stripRef.current;
    const button = thumbnails.current[selectedIndex];
    if (!strip || !button) return;
    const left = button.offsetLeft - strip.offsetLeft - (strip.clientWidth - button.clientWidth) / 2;
    strip.scrollTo({ left, behavior: motionBehavior() });
  }, [selectedIndex, mobilePane]);

  function selectPhoto(index: number, focusThumbnail = false) {
    const next = (index + photos.length) % photos.length;
    setSelectedIndex(next);
    if (mode === 'year') setMode('explore');
    if (focusThumbnail) thumbnails.current[next]?.focus({ preventScroll: true });
  }

  function thumbnailKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowRight') { event.preventDefault(); selectPhoto(index + 1, true); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); selectPhoto(index - 1, true); }
    else if (event.key === 'Home') { event.preventDefault(); selectPhoto(0, true); }
    else if (event.key === 'End') { event.preventDefault(); selectPhoto(photos.length - 1, true); }
  }

  function modeKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % modes.length;
    else if (event.key === 'ArrowLeft') next = (index + modes.length - 1) % modes.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = modes.length - 1;
    else return;
    event.preventDefault();
    setMode(modes[next].id);
    modeButtons.current[next]?.focus();
  }

  function openWall(focusComposer = false) {
    setMobilePane('wall');
    if (focusComposer) window.setTimeout(() => noteRef.current?.focus({ preventScroll: true }), 0);
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim() || !presenceReady || sending || sendingRef.current) return;
    sendingRef.current = true;
    setFormFeedback('');
    try {
      const saved = await sendMessage(name.trim(), body.trim());
      if (saved) {
        setName('');
        setBody('');
        setFormFeedback('Your farewell is on the wall. Thank you.');
        feedRef.current?.scrollTo({ top: 0, behavior: motionBehavior() });
      }
    } finally { sendingRef.current = false; }
  }

  async function reconnect() { await retryPresence(); await refresh(); }

  async function shareRoom() {
    const url = `${window.location.origin}${window.location.pathname}`;
    setShareFeedback('');
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Dear Jensen — a farewell, built together', text: 'Explore the photographs, play a little, and leave your farewell to Jensen Huang.', url });
        return;
      } catch (error) { if (error instanceof Error && error.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); setShareFeedback('Link copied. Invite someone in.'); }
    catch { setShareUrl(url); setShareFeedback('Copy this link to invite someone in.'); }
  }

  return (
    <div className={`living-room is-${mobilePane}`}>
      <img className="nvidia-backdrop-logo" src="/nvidia.svg" alt="" aria-hidden="true" />
      <a className="skip-link" href="#community-room">Skip to the community room</a>
      <header className="room-header">
        <a className="wordmark" href="#community-room" aria-label="Dear Jensen"><img className="nvidia-header-logo" src="/nvidia.svg" alt="" width="38" height="38" /><span>DEAR<br />JENSEN.</span></a>
        <span className="room-description">THE COMMUNITY<br />LIVING ROOM.</span>
        <div className="room-presence"><span className={`status-dot${stale || !stats ? ' is-muted' : ''}`} aria-hidden="true" /><span>{stats && !stale ? <><strong>{numberFormat.format(stats.onlineNow)}</strong> here now</> : stale || presenceError ? 'Live count unavailable' : 'Connecting…'}</span><span className="presence-help" title="Approximate number of browsers active in the last 90 seconds" aria-label="Approximate online presence">~</span></div>
        <div className="header-actions"><button className={`thanks-button${participated ? ' is-thanked' : ''}`} disabled={participated || !presenceReady || phase === 'submitting'} onClick={() => void join()}>{participated ? <span aria-hidden="true">✓</span> : <span aria-hidden="true">+</span>}{participated ? 'Thanks added' : phase === 'submitting' ? 'Adding…' : 'Add your thanks'}{stats && <span className="thanks-total">{numberFormat.format(stats.totalTributes)}</span>}</button><button className="share-button" onClick={() => void shareRoom()}>Invite a friend <Arrow direction="up-right" /></button></div>
      </header>

      <div className="room-welcome"><div><p className="eyebrow">A FAREWELL, BUILT TOGETHER.</p><h1>Thank you, <em>Jensen.</em></h1><p className="welcome-subtitle">A little gratitude. A little play. A whole community.</p></div><button className={`latest-farewell${latestMessage ? '' : ' latest-empty'}`} onClick={() => openWall(true)}><span className="latest-label"><span className="tiny-spark" aria-hidden="true">✳</span>{latestMessage ? 'THE LATEST LITTLE THANK-YOU' : 'THERE’S A PLACE HERE FOR YOU'}</span><span className="latest-body">{latestMessage ? <><strong>{latestMessage.name || 'A fellow builder'}:</strong> {latestMessage.body}</> : 'Play with a memory. Leave a few words. Stay a while.'}</span><Arrow direction="up-right" /></button></div>

      <nav className="mobile-room-switch" aria-label="Community room views"><button className={mobilePane === 'photos' ? 'is-active' : ''} aria-pressed={mobilePane === 'photos'} onClick={() => setMobilePane('photos')}><ModeIcon mode="explore" />Play &amp; explore</button><button className={mobilePane === 'wall' ? 'is-active' : ''} aria-pressed={mobilePane === 'wall'} onClick={() => setMobilePane('wall')}>Farewell wall<span>{wallCount}</span></button></nav>

      <main id="community-room" className="room-main">
        <section className="photo-room" aria-label="Explore photographs and play games">
          <div className="photo-room-toolbar"><div className="photo-tabs" role="tablist" aria-label="Photo activities">{modes.map((item, index) => <button key={item.id} id={`tab-${item.id}`} ref={(element) => { modeButtons.current[index] = element; }} type="button" role="tab" aria-selected={mode === item.id} aria-controls={`panel-${item.id}`} tabIndex={mode === item.id ? 0 : -1} className={mode === item.id ? 'is-active' : ''} onClick={() => setMode(item.id)} onKeyDown={(event) => modeKey(event, index)}><ModeIcon mode={item.id} />{item.label}</button>)}</div>{restored.size > 0 && <span className="restored-badge" title="Photo puzzles completed during this visit">{restored.size} {restored.size === 1 ? 'memory' : 'memories'} restored</span>}</div>
          <div id={`panel-${mode}`} role="tabpanel" aria-labelledby={`tab-${mode}`} className={`activity-panel activity-${mode}`}>
            {!photo ? <div className="photo-empty"><h2>The photographs are on their way.</h2><p>You can still leave a farewell on the wall.</p></div> : mode === 'explore' ? <>
              <div className="explore-stage" tabIndex={0} aria-label="Photograph viewer. Use left and right arrow keys to explore." onKeyDown={(event) => { if (event.key === 'ArrowRight') { event.preventDefault(); selectPhoto(selectedIndex + 1); } if (event.key === 'ArrowLeft') { event.preventDefault(); selectPhoto(selectedIndex - 1); } }}>
                <img key={photo.id} className="explore-photo" src={photo.src} srcSet={photo.srcSet || undefined} sizes="(max-width: 900px) 95vw, 65vw" width={photo.width} height={photo.height} alt={photo.caption || 'Jensen Huang'} fetchPriority="high" decoding="async" />
                <div className="photo-navigation"><button className="icon-button" onClick={() => selectPhoto(selectedIndex - 1)} aria-label="Previous photograph"><Arrow direction="left" /></button><span>{String(selectedIndex + 1).padStart(2, '0')} <i>/ {photos.length}</i></span><button className="icon-button" onClick={() => selectPhoto(selectedIndex + 1)} aria-label="Next photograph"><Arrow /></button></div>
                <span className="photo-year-stamp">{photo.year}</span>
              </div>
              <div className="explore-caption"><div><p>{photo.caption}</p><PhotographCredit photo={photo} /></div><button className="play-photo-button" onClick={() => setMode('puzzle')}><ModeIcon mode="puzzle" />Play this photo <Arrow /></button></div>
            </> : <div className="game-stage">{mode === 'puzzle' ? <PhotoPuzzle key={photo.id} photo={photo} onComplete={() => setRestored((previous) => new Set([...previous, photo.id]))} /> : <YearQuiz photos={photos} />}</div>}
          </div>
        </section>

        <aside className="farewell-wall" aria-labelledby="wall-title"><div className="wall-heading"><div><span className="wall-mark" aria-hidden="true">✳</span><h2 id="wall-title">The farewell wall</h2></div><span className="wall-count">{wallCount} <span>{totalMessages === 1 ? 'note' : 'notes'}</span></span></div>
          <div className="message-feed" ref={feedRef} aria-label="Latest public farewell messages" aria-busy={loading}>
            {sortedMessages.length ? <ol>{sortedMessages.map((message) => <li key={message.id} className="farewell-note"><div className="note-byline"><strong>{message.name || 'A fellow builder'}</strong><time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>{messageTime(message.createdAt)}</time></div><p>{message.body}</p></li>)}</ol> : <div className="empty-wall"><span className="empty-wall-mark" aria-hidden="true">“</span><h3>{loading ? 'Opening the wall…' : messageError ? 'We’ll reconnect.' : 'The first words\ncan be yours.'}</h3><p>{loading ? 'Finding the latest farewells.' : messageError ? 'The photographs and games are still here to explore.' : 'A thank-you, a memory, or a wish for what comes next.'}</p></div>}
          </div>
          <form className="message-form" onSubmit={(event) => void submitMessage(event)}>
            <label className="compose-label" htmlFor="farewell-message">Leave a little gratitude.</label>
            <div className="message-textarea"><textarea id="farewell-message" ref={noteRef} value={body} onChange={(event) => { setBody(limitText(event.target.value, 240)); setFormFeedback(''); }} rows={3} placeholder="Dear Jensen, …" required disabled={sending} aria-describedby="message-public-note" /><span className="character-count" aria-label={`${Array.from(body).length} of 240 characters`}>{Array.from(body).length}<span> / 240</span></span></div>
            <div className="message-send-row"><label className="sr-only" htmlFor="farewell-name">Your name, optional</label><input id="farewell-name" value={name} onChange={(event) => setName(limitText(event.target.value, 32))} placeholder="Your name (optional)" autoComplete="nickname" disabled={sending} /><button className="send-message-button" type="submit" disabled={sending || !body.trim() || !presenceReady} aria-busy={sending}>{sending ? 'Posting…' : 'Leave a farewell'}<Arrow /></button></div>
            <p id="message-public-note" className="public-note">Messages appear publicly. A little kindness goes a long way.</p>
            <p className="form-feedback" role="status" aria-live="polite">{formFeedback}</p>
            {(messageError || presenceError) && <div className="wall-error"><p role="alert">{messageError || presenceError}</p><button type="button" onClick={() => void reconnect()} disabled={phase === 'initializing' || loading}>Try again <Arrow /></button></div>}
          </form>
        </aside>
      </main>

      <section className="photo-shelf" aria-label="Choose a photograph"><div className="shelf-heading"><h2>Pick a moment.</h2><span>{photos.length} real photographs. A few ways to play.</span><div className="shelf-controls"><button className="icon-button" aria-label="Scroll photographs left" onClick={() => stripRef.current?.scrollBy({ left: -400, behavior: motionBehavior() })}><Arrow direction="left" /></button><button className="icon-button" aria-label="Scroll photographs right" onClick={() => stripRef.current?.scrollBy({ left: 400, behavior: motionBehavior() })}><Arrow /></button></div></div><div className="photo-strip" ref={stripRef} role="group" aria-label="Photographs; use arrow keys to browse">{photos.map((item, index) => <button key={item.id} ref={(element) => { thumbnails.current[index] = element; }} className={`photo-thumbnail${selectedIndex === index ? ' is-selected' : ''}`} aria-pressed={selectedIndex === index} aria-label={mode === 'year' ? `Photograph ${index + 1}` : `${item.caption}, photograph ${index + 1} of ${photos.length}`} tabIndex={selectedIndex === index ? 0 : -1} onClick={() => selectPhoto(index)} onKeyDown={(event) => thumbnailKey(event, index)}><img src={item.srcSet?.split(',')[0]?.trim().split(' ')[0] || item.src} alt="" width={item.width} height={item.height} loading="lazy" style={{ objectPosition: item.height > item.width ? 'center 20%' : 'center' }} /><span>{mode === 'year' ? String(index + 1).padStart(2, '0') : item.year}</span></button>)}</div></section>

      <footer className="room-footer"><a className="maker-credit" href="https://www.linkedin.com/in/ayush-pathania-9a025b31b/" target="_blank" rel="noopener noreferrer">Made by <strong>Ayush Pathania</strong></a><div className="footer-tools"><button onClick={() => void shareRoom()}>Share the room <Arrow direction="up-right" /></button><details className="room-credits"><summary>About &amp; photo credits</summary><div className="room-credits-panel"><h2>A farewell, built together.</h2><p>An independent community tribute, following <a href={announcementUrl} target="_blank" rel="noreferrer">NVIDIA’s announcement</a> of Jensen Huang’s resignation on 12 November 2026. Not affiliated with or endorsed by NVIDIA or Jensen Huang.</p><p>Real photographs, with gratitude to their creators. Explore mode shows complete photographs; thumbnails and puzzle pieces may be cropped. Games and restored-memory badges belong to this visit. Public farewells are shared with everyone.</p><ol>{photos.map((item) => <li key={item.id}><a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.caption}</a><span>{item.creator} · <a href={item.licenseUrl || item.sourceUrl} target="_blank" rel="noreferrer">{item.license}</a></span><small>{item.changes}</small></li>)}</ol></div></details></div></footer>
      {(shareFeedback || shareUrl) && <div className="share-feedback" role="status"><p>{shareFeedback}</p>{shareUrl && <input readOnly value={shareUrl} aria-label="Link to this community room" onFocus={(event) => event.currentTarget.select()} />}<button onClick={() => { setShareFeedback(''); setShareUrl(''); }} aria-label="Dismiss share message">×</button></div>}
    </div>
  );
}
