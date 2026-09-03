import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../contexts/AuthContext';
import { logActivity } from '../lib/logActivity';

// Fullscreen, chrome-free presentation view for actually performing a
// giveaway draw on camera (livestream / screen recording) — deliberately a
// standalone top-level route (see routes.tsx), NOT nested under AdminShell,
// so nothing else in the admin system (sidebar, other campaigns, entrant
// PII) is ever on screen. Still gated by ProtectedRoute(admin/manager) and
// still performs the real draw via the same RPC the main Giveaways page
// uses — this is a real control surface, not just a visualization.
//
// Only ever displays a public-safe reduction of the winner's name (see
// toPublicName, mirrors notify-skola-giveaway-event.js's helper) plus their
// entry number and location — never the winning entrant's phone or email,
// even though the admin viewing this page could otherwise see those in the
// main Entries table.

type Phase = 'loading' | 'idle' | 'drawing' | 'revealed' | 'closed' | 'error';

interface CampaignRow {
  id: string;
  public_title: string;
  status: string;
  hero_config: { heroImageDesktop?: string; heroImageMobile?: string } | null;
}

interface WinnerInfo {
  publicName: string;
  entryPosition: number | null;
  location: string | null;
}

/** "Chioma Okafor" -> "Chioma O." — mirrors notify-skola-giveaway-event.js's toPublicName exactly. */
function toPublicName(fullName: string | null | undefined): string {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

const SAMPLE_REEL_NAMES = ['Ada O.', 'Tunde B.', 'Ifeoma K.', 'Bola A.', 'Chinedu E.', 'Grace U.', 'Musa D.', 'Sarah N.', 'Kelechi O.', 'Fatima Y.', 'Emeka N.', 'Ruth P.'];

export default function DrawLivePage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const [phase, setPhase] = useState<Phase>('loading');
  const [campaign, setCampaign] = useState<CampaignRow | null>(null);
  const [entryCount, setEntryCount] = useState(0);
  const [eligibleCount, setEligibleCount] = useState(0);
  const [winner, setWinner] = useState<WinnerInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [reelName, setReelName] = useState(SAMPLE_REEL_NAMES[0]);
  const [reelPos, setReelPos] = useState(1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  async function load() {
    if (!campaignId) return;
    setPhase('loading');
    setErrorMsg(null);

    const { data: c, error: cErr } = await supabase
      .from('campaigns')
      .select('id, public_title, status, hero_config')
      .eq('id', campaignId)
      .eq('campaign_kind', 'giveaway')
      .maybeSingle();
    if (cErr || !c) {
      setErrorMsg('Giveaway campaign not found.');
      setPhase('error');
      return;
    }
    setCampaign(c as CampaignRow);

    const [{ count: validCount }, { count: eligible }, { data: drawRows }] = await Promise.all([
      supabase.from('giveaway_entries').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('status', 'valid'),
      supabase.from('giveaway_entries').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('status', 'valid').eq('winner_status', 'none'),
      supabase.from('giveaway_draws').select('winning_entry_id').eq('campaign_id', campaignId).eq('status', 'completed').order('drawn_at', { ascending: false }).limit(1),
    ]);
    setEntryCount(validCount || 0);
    setEligibleCount(eligible || 0);

    const existingDraw = drawRows?.[0];
    if (existingDraw?.winning_entry_id) {
      await loadWinner(existingDraw.winning_entry_id);
      setPhase('revealed');
    } else {
      setPhase('idle');
    }
  }

  async function loadWinner(entryId: string) {
    const { data: entry } = await supabase
      .from('giveaway_entries')
      .select('full_name, entry_position, location')
      .eq('id', entryId)
      .maybeSingle();
    setWinner({
      publicName: toPublicName(entry?.full_name),
      entryPosition: entry?.entry_position ?? null,
      location: entry?.location ?? null,
    });
  }

  function notifySkola(eventType: 'giveaway.winner_drawn', id: string) {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.access_token) return;
      fetch('/.netlify/functions/notify-skola-giveaway-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ event_type: eventType, campaign_id: id }),
      }).catch((error) => console.warn('Skola notification failed (non-blocking):', error));
    });
  }

  async function handleDraw() {
    if (!campaignId || drawingRef.current) return;
    drawingRef.current = true;
    setPhase('drawing');
    setErrorMsg(null);

    let ticks = 0;
    const reelInterval = setInterval(() => {
      ticks++;
      setReelName(SAMPLE_REEL_NAMES[Math.floor(Math.random() * SAMPLE_REEL_NAMES.length)]);
      setReelPos(1 + Math.floor(Math.random() * Math.max(entryCount, 1)));
    }, 90);

    const minDelay = new Promise((resolve) => setTimeout(resolve, 1800));
    const [rpcResult] = await Promise.all([
      supabase.rpc('draw_giveaway_winner', { p_campaign_id: campaignId }),
      minDelay,
    ]);

    clearInterval(reelInterval);
    drawingRef.current = false;

    if (rpcResult.error || !rpcResult.data) {
      setErrorMsg(rpcResult.error?.message || 'Draw failed');
      await load();
      return;
    }

    const draw = rpcResult.data as { id: string; winning_entry_id: string };
    await loadWinner(draw.winning_entry_id);
    setPhase('revealed');
    burstConfetti();
    logActivity({ action: 'GIVEAWAY_DRAW', resource_type: 'campaign', resource_id: campaignId }).catch(() => {});
    notifySkola('giveaway.winner_drawn', campaignId);
  }

  function burstConfetti() {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    canvas.width = stage.clientWidth;
    canvas.height = stage.clientHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const colors = ['#b8860b', '#ff5a36', '#7c3aed', '#4c1d95'];
    const pieces = Array.from({ length: 140 }, () => ({
      x: canvas.width / 2 + (Math.random() - 0.5) * 120,
      y: canvas.height * 0.4,
      vx: (Math.random() - 0.5) * 11,
      vy: Math.random() * -9 - 3,
      size: 4 + Math.random() * 5,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));
    const gravity = 0.28;
    let frame = 0;
    const maxFrames = 130;

    function tick() {
      if (!ctx || !canvas) return;
      frame++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach((p) => {
        p.vy += gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, 1 - frame / maxFrames);
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
        ctx.restore();
      });
      if (frame < maxFrames) requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    requestAnimationFrame(tick);
  }

  const heroImage = campaign?.hero_config?.heroImageDesktop || campaign?.hero_config?.heroImageMobile || '';

  return (
    <div className="dl-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Public+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap');
        .dl-root{
          --bg:#ffffff; --violet-wash:#eee2fb; --violet:#7c3aed; --violet-deep:#4c1d95;
          --gold:#b8860b; --gold-soft:#f6ecd3; --ember:#ff5a36; --ink:#211334; --ink-dim:#7b7290;
          --line:rgba(76,29,149,0.14);
          margin:0; min-height:100vh; background:var(--bg); color:var(--ink);
          font-family:'Public Sans',ui-sans-serif,system-ui,sans-serif;
        }
        .dl-exit{
          position:absolute; top:16px; left:18px; z-index:5;
          font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:.06em;
          color:var(--ink-dim); text-decoration:none; opacity:.55;
        }
        .dl-exit:hover{opacity:1; color:var(--violet);}
        .dl-stage{
          position:relative; min-height:100vh; display:flex; align-items:center; justify-content:center;
          padding:48px 24px; isolation:isolate;
          background:radial-gradient(ellipse 900px 700px at 50% 42%, var(--violet-wash) 0%, #ffffff 62%, #ffffff 100%);
        }
        .dl-stage.revealed{
          background:radial-gradient(ellipse 1100px 850px at 50% 42%, var(--gold-soft) 0%, var(--violet-wash) 48%, #ffffff 86%);
          transition:background 1.1s ease;
        }
        .dl-content{ position:relative; z-index:2; display:flex; flex-direction:column; align-items:center; text-align:center; max-width:820px; width:100%; }
        .dl-eyebrow{ font-family:'IBM Plex Mono',monospace; font-size:12px; letter-spacing:.22em; text-transform:uppercase; color:var(--violet); display:flex; align-items:center; gap:8px; margin-bottom:22px; }
        .dl-live-dot{ width:7px; height:7px; border-radius:50%; background:var(--ember); animation:dl-pulse 1.6s infinite; }
        @keyframes dl-pulse{ 0%{box-shadow:0 0 0 0 rgba(255,90,54,.55);} 70%{box-shadow:0 0 0 10px rgba(255,90,54,0);} 100%{box-shadow:0 0 0 0 rgba(255,90,54,0);} }
        .dl-title{ font-family:'Bricolage Grotesque',sans-serif; font-weight:600; font-size:clamp(20px,2.6vw,28px); color:var(--ink-dim); margin:0 0 40px; }
        .dl-prize-card{ display:flex; flex-direction:column; align-items:center; margin-bottom:40px; }
        .dl-prize-img{ width:140px; height:140px; object-fit:cover; border-radius:24px; background:#fff; border:1px solid var(--line); box-shadow:0 14px 30px -16px rgba(76,29,149,.35); }
        .dl-entry-count{ font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:clamp(52px,11vw,104px); font-weight:600; color:var(--ink); line-height:1; letter-spacing:-.02em; }
        .dl-entry-label{ font-size:14px; color:var(--ink-dim); margin-top:10px; letter-spacing:.04em; }
        .dl-draw-btn{ margin-top:52px; font-family:'Bricolage Grotesque',sans-serif; font-weight:700; font-size:19px; padding:18px 52px; border-radius:999px; border:none; background:linear-gradient(180deg,#d1a53a 0%,var(--gold) 100%); color:#2b1a02; cursor:pointer; box-shadow:0 10px 26px -10px rgba(184,134,11,.45); transition:transform .15s ease, box-shadow .15s ease; }
        .dl-draw-btn:hover:not(:disabled){ transform:translateY(-2px); box-shadow:0 14px 30px -10px rgba(184,134,11,.55); }
        .dl-draw-btn:disabled{ opacity:.4; cursor:default; }
        .dl-reel-label{ font-family:'IBM Plex Mono',monospace; font-size:12px; letter-spacing:.18em; text-transform:uppercase; color:var(--violet); margin-bottom:18px; }
        .dl-reel{ font-family:'Bricolage Grotesque',sans-serif; font-weight:700; font-size:clamp(34px,7vw,64px); color:var(--ink); min-height:1.2em; display:flex; align-items:center; justify-content:center; }
        .dl-reel-sub{ margin-top:14px; font-family:'IBM Plex Mono',monospace; font-size:14px; color:var(--ink-dim); }
        .dl-reveal{ display:flex; flex-direction:column; align-items:center; animation:dl-riseIn .6s cubic-bezier(.2,.9,.25,1); }
        @keyframes dl-riseIn{ from{opacity:0; transform:translateY(18px) scale(.97);} to{opacity:1; transform:translateY(0) scale(1);} }
        .dl-winner-tag{ font-family:'IBM Plex Mono',monospace; font-size:13px; letter-spacing:.2em; text-transform:uppercase; color:var(--violet); margin-bottom:18px; }
        .dl-winner-name{ font-family:'Bricolage Grotesque',sans-serif; font-weight:800; font-size:clamp(42px,9vw,88px); line-height:1.02; background:linear-gradient(135deg,var(--violet-deep) 0%, var(--gold) 100%); -webkit-background-clip:text; background-clip:text; color:transparent; text-wrap:balance; }
        .dl-winner-meta{ margin-top:16px; display:flex; gap:10px; align-items:center; font-family:'IBM Plex Mono',monospace; font-size:15px; color:var(--ink); }
        .dl-winner-meta .dl-dot{ color:var(--ink-dim); }
        .dl-prize-line{ margin-top:28px; font-size:16px; color:var(--ink-dim); max-width:520px; }
        .dl-prize-line strong{ color:var(--ink); font-weight:600; }
        .dl-error{ margin-top:20px; font-size:13px; color:#b91c1c; }
        canvas.dl-fx{ position:absolute; inset:0; z-index:3; pointer-events:none; }
        .dl-footer{ position:absolute; bottom:22px; left:0; right:0; text-align:center; font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:rgba(33,19,52,.3); z-index:2; }
      `}</style>

      <Link to="/admin/giveaways" className="dl-exit">← exit</Link>

      <div className={`dl-stage${phase === 'revealed' ? ' revealed' : ''}`} ref={stageRef}>
        <div className="dl-content">
          {phase === 'loading' && <div className="dl-entry-label">Loading…</div>}

          {phase === 'error' && <div className="dl-error">{errorMsg}</div>}

          {(phase === 'idle' || phase === 'drawing' || phase === 'revealed') && campaign && (
            <>
              <div className="dl-eyebrow"><span className="dl-live-dot" /> Live Draw · Secret Drop</div>
              <h1 className="dl-title">{campaign.public_title}</h1>

              {heroImage && (
                <div className="dl-prize-card">
                  <img src={heroImage} alt="" className="dl-prize-img" />
                </div>
              )}

              {phase === 'idle' && (
                <>
                  <div className="dl-entry-count">{entryCount}</div>
                  <div className="dl-entry-label">entries locked in</div>
                  <button className="dl-draw-btn" onClick={handleDraw} disabled={eligibleCount === 0}>
                    {eligibleCount === 0 ? 'No eligible entries' : 'Draw the Winner'}
                  </button>
                  {errorMsg && <div className="dl-error">{errorMsg}</div>}
                </>
              )}

              {phase === 'drawing' && (
                <div>
                  <div className="dl-reel-label">Selecting at random</div>
                  <div className="dl-reel">{reelName}</div>
                  <div className="dl-reel-sub">entry #{reelPos} of {entryCount}</div>
                </div>
              )}

              {phase === 'revealed' && winner && (
                <div className="dl-reveal">
                  <div className="dl-winner-tag">The winner is</div>
                  <div className="dl-winner-name">{winner.publicName}</div>
                  <div className="dl-winner-meta">
                    {winner.entryPosition != null && <>Entry #{winner.entryPosition}</>}
                    {winner.entryPosition != null && winner.location && <span className="dl-dot">·</span>}
                    {winner.location}
                  </div>
                  <div className="dl-prize-line">Winner of <strong>{campaign.public_title}</strong>.</div>
                </div>
              )}
            </>
          )}
        </div>
        <canvas ref={canvasRef} className="dl-fx" />
        <div className="dl-footer">julinemart.com</div>
      </div>
    </div>
  );
}
