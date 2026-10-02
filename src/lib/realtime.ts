// Real-time layer (Supabase Realtime Broadcast + Presence).
// - No new DB tables needed: uses ephemeral channels (works once Realtime is enabled).
// - Announcements: admin device broadcasts, all player devices receive instantly.
// - Queue: per-mode presence shows real online count; 2+ online = real-player sync.
// - Chat: per-room broadcast (roomId = mode id for lobby chat in this step).
// - Voice: WebRTC P2P + Supabase signaling (STUN only; TURN needed for strict NAT).
import { supabase, hasSupabase } from './supabase'
import { useStore } from './store'
import { useCallback, useEffect, useRef, useState } from 'react'

const peerId = () => useStore.getState().playerId || ('guest-' + Math.random().toString(36).slice(2, 8))

// ---------- announcements ----------
export function broadcastAnnouncement(a: { titleBn: string; titleEn: string; bodyBn: string; bodyEn: string }) {
  if (!hasSupabase || !supabase) return
  supabase.channel('global-announce').send({ type: 'broadcast', event: 'announce', payload: { ...a, from: peerId() } })
}

export function initRealtimeAnnouncements() {
  if (!hasSupabase || !supabase) return
  supabase
    .channel('global-announce')
    .on('broadcast', { event: 'announce' }, (msg: any) => {
      const p = msg.payload
      if (!p || p.from === peerId()) return
      useStore.getState().postAnnouncement({ titleBn: p.titleBn, titleEn: p.titleEn, bodyBn: p.bodyBn, bodyEn: p.bodyEn })
    })
    .subscribe()
}

// ---------- queue presence ----------
export function useQueueCount(modeId: string): number {
  const [n, setN] = useState(1)
  useEffect(() => {
    if (!hasSupabase || !supabase) return
    const ch = supabase.channel(`queue:${modeId}`, { config: { presence: { key: peerId() } } })
    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState()
      setN(Object.keys(st).length || 1)
    })
    ch.subscribe(async (s: string) => { if (s === 'SUBSCRIBED') await ch.track({ online_at: Date.now() }) })
    return () => { supabase!.removeChannel(ch) }
  }, [modeId])
  return n
}

export function pingQueueReady(modeId: string) {
  if (!hasSupabase || !supabase) return
  supabase.channel(`queue:${modeId}`).send({ type: 'broadcast', event: 'ready', payload: { from: peerId(), at: Date.now() } })
}

// ---------- room chat ----------
export interface RoomMsg { from: string; text: string; at: number }
export function useRoomChat(roomId: string | null, botFallback: () => void) {
  const [msgs, setMsgs] = useState<RoomMsg[]>([])
  useEffect(() => {
    if (!roomId || !hasSupabase || !supabase) return
    const ch = supabase.channel(`match:${roomId}`)
    ch.on('broadcast', { event: 'chat' }, (msg: any) => {
      const p = msg.payload as RoomMsg
      if (!p || p.from === peerId()) return
      setMsgs((m) => [...m, p])
    })
    ch.subscribe()
    return () => { supabase!.removeChannel(ch) }
  }, [roomId])
  const send = (text: string) => {
    const v = text.trim()
    if (!v) return false
    const m: RoomMsg = { from: peerId(), text: v, at: Date.now() }
    setMsgs((x) => [...x, m])
    if (hasSupabase && supabase && roomId) {
      supabase.channel(`match:${roomId}`).send({ type: 'broadcast', event: 'chat', payload: m })
    } else {
      botFallback()
    }
    return true
  }
  return { msgs, send }
}

// ---------- voice room (WebRTC P2P, STUN-only) ----------
// Returns { on, level, error, toggle }. Level 0..1 from mic analyser.
// Error-free: stale closures removed (refs), full cleanup, mic-denied surfaced.
export function useVoiceRoom(roomId: string | null) {
  const [on, setOn] = useState(false)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // how many peers we actually have a live connection to. Previously the UI only
  // knew "mic is on", which reads identically whether the call connected, failed,
  // or never found anyone - so there was no way to tell a working voice chat from
  // a dead one.
  const [peerCount, setPeerCount] = useState(0)
  const [live, setLive] = useState(false)
  const pcs = useRef(new Map<string, RTCPeerConnection>())
  // ICE that arrived before the remote description did. addIceCandidate throws
  // InvalidStateError in that state, and the catch used to swallow it, so the
  // candidate was lost and the call simply never connected - which looks exactly
  // like "voice chat does not work". Candidates are held here and replayed the
  // moment the description lands.
  const pendingIce = useRef(new Map<string, RTCIceCandidateInit[]>())
  // <audio> elements are created on track, so cleanup has to be able to reach them
  const audios = useRef(new Set<HTMLAudioElement>())
  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef(0)
  const chRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null)
  const onRef = useRef(false)
  // a second tap while getUserMedia is still pending would open a second mic
  const starting = useRef(false)
  useEffect(() => { onRef.current = on }, [on])

  const cleanup = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    pcs.current.forEach((pc) => { try { pc.close() } catch {} })
    pcs.current.clear()
    pendingIce.current.clear()
    audios.current.forEach((a) => {
      try { a.pause(); a.srcObject = null; a.remove() } catch {}
    })
    audios.current.clear()
    streamRef.current?.getTracks().forEach((t) => { try { t.stop() } catch {} })
    streamRef.current = null
    try { ctxRef.current?.close() } catch {}
    ctxRef.current = null
    if (chRef.current && supabase) { try { supabase.removeChannel(chRef.current) } catch {} chRef.current = null }
    starting.current = false
    setOn(false); setLevel(0); setPeerCount(0); setLive(false)
  }, [])

  useEffect(() => cleanup, [cleanup])
  useEffect(() => () => cleanup(), [roomId, cleanup])

  // returns null = success/off, otherwise error code ('mic-denied' | 'mic-unsupported' | 'insecure')
  const toggle = useCallback(async (): Promise<string | null> => {
    if (onRef.current) { cleanup(); return null }
    if (starting.current) return null // a tap already in flight
    starting.current = true
    setError(null)
    // mic is blocked on plain-HTTP origins (e.g. http://192.168.x.x) — only
    // https:// or localhost are secure contexts. Surface it honestly.
    if (typeof window !== 'undefined' && window.isSecureContext === false) { starting.current = false; setError('insecure'); return 'insecure' }
    if (!navigator.mediaDevices?.getUserMedia) { starting.current = false; setError('mic-unsupported'); return 'mic-unsupported' }
    let mic: MediaStream
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch (e) {
      const name = (e as DOMException)?.name
      const code = name === 'NotFoundError' || name === 'OverconstrainedError' ? 'mic-unsupported' : 'mic-denied'
      starting.current = false
      setError(code)
      return code
    }
    streamRef.current = mic
    try {
      const ctx = new AudioContext()
      ctxRef.current = ctx
      const src = ctx.createMediaStreamSource(mic)
      const an = ctx.createAnalyser()
      an.fftSize = 256
      src.connect(an)
      const buf = new Uint8Array(an.frequencyBinCount)
      const tick = () => {
        if (!streamRef.current) return
        an.getByteTimeDomainData(buf)
        let peak = 0
        for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128) / 128)
        setLevel(peak)
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()
    } catch { /* meter optional */ }
    setOn(true)
    if (!hasSupabase || !supabase || !roomId) return null // local mic-only mode
    try {
      const me = peerId()
      const ch = supabase.channel(`voice:${roomId}`)
      chRef.current = ch
      const mkPc = (remoteId: string) => {
        const old = pcs.current.get(remoteId)
        if (old) { try { old.close() } catch {} }
        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] })
        mic.getTracks().forEach((t) => pc.addTrack(t, mic))
        pc.onicecandidate = (e) => {
          if (e.candidate) ch.send({ type: 'broadcast', event: 'ice', payload: { from: me, to: remoteId, ice: e.candidate } }).catch(() => {})
        }
        pc.ontrack = (e) => {
          try {
            const audio = new Audio()
            // playsInline matters inside the APK: without it Android's WebView
            // treats the stream as a fullscreen video and never plays it as audio.
            // Real and widely supported, but missing from the DOM lib's types.
            ;(audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true
            audio.autoplay = true
            audio.srcObject = e.streams[0] ?? new MediaStream([e.track])
            audios.current.add(audio)
            audio.play().catch(() => {
              // autoplay refused. The transient user gesture from tapping the mic
              // button has usually expired by the time a remote track lands, so
              // retry on the next interaction instead of dropping the call silently.
              const retry = () => {
                audio.play().catch(() => {})
                window.removeEventListener('pointerdown', retry)
                window.removeEventListener('keydown', retry)
              }
              window.addEventListener('pointerdown', retry, { once: true })
              window.addEventListener('keydown', retry, { once: true })
            })
          } catch {}
        }
        // a peer that dies was still counted as connected forever, and its audio
        // element kept a dead stream attached
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
            pcs.current.delete(remoteId)
            pendingIce.current.delete(remoteId)
            setPeerCount(pcs.current.size)
            setLive(pcs.current.size > 0)
          } else if (pc.connectionState === 'connected') {
            setPeerCount(pcs.current.size)
            setLive(true)
          }
        }
        pcs.current.set(remoteId, pc)
        return pc
      }
      /** replay the ICE that arrived before we had anywhere to put it */
      const flushIce = async (pc: RTCPeerConnection, remoteId: string) => {
        const queued = pendingIce.current.get(remoteId)
        if (!queued?.length) return
        pendingIce.current.delete(remoteId)
        for (const c of queued) {
          try { await pc.addIceCandidate(c) } catch {}
        }
      }
      ch.on('broadcast', { event: 'voice-join' }, async (msg: any) => {
        try {
          if (msg.payload.from === me) return
          const pc = mkPc(msg.payload.from)
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          await ch.send({ type: 'broadcast', event: 'voice-offer', payload: { from: me, to: msg.payload.from, sdp: offer } })
        } catch {}
      })
      ch.on('broadcast', { event: 'voice-offer' }, async (msg: any) => {
        try {
          if (msg.payload.to !== me) return
          const pc = mkPc(msg.payload.from)
          await pc.setRemoteDescription(msg.payload.sdp)
          await flushIce(pc, msg.payload.from)
          const ans = await pc.createAnswer()
          await pc.setLocalDescription(ans)
          await ch.send({ type: 'broadcast', event: 'voice-answer', payload: { from: me, to: msg.payload.from, sdp: ans } })
        } catch {}
      })
      ch.on('broadcast', { event: 'voice-answer' }, async (msg: any) => {
        try {
          if (msg.payload.to !== me) return
          const pc = pcs.current.get(msg.payload.from)
          if (!pc) return
          await pc.setRemoteDescription(msg.payload.sdp)
          await flushIce(pc, msg.payload.from)
        } catch {}
      })
      ch.on('broadcast', { event: 'ice' }, async (msg: any) => {
        try {
          if (msg.payload.to !== me) return
          const pc = pcs.current.get(msg.payload.from)
          // no connection yet, or no description on it: hold it rather than drop it
          if (!pc || !pc.remoteDescription) {
            const list = pendingIce.current.get(msg.payload.from) ?? []
            list.push(msg.payload.ice)
            pendingIce.current.set(msg.payload.from, list)
            return
          }
          await pc.addIceCandidate(msg.payload.ice)
        } catch {}
      })
      await ch.subscribe()
      await ch.send({ type: 'broadcast', event: 'voice-join', payload: { from: me } })
    } catch {
      // signaling failed — mic-only mode keeps working
    }
    return null
  }, [roomId, cleanup])

  return { on, level, error, toggle, peerCount, live }
}
