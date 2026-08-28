'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { Circle, CircleMarker, Map as LeafletMap } from 'leaflet';
import { deleteRecording, listRecordings, saveRecording, type SavedRecording } from './recordings';

type Position = { lat: number; lng: number; accuracy: number; updatedAt: number };
type NearbyDevice = { id: string; name: string; connected: boolean };
type Message = { id: number; role: 'you' | 'khan'; text: string };
type BluetoothDeviceLike = {
  id: string;
  name?: string;
  gatt?: { connected: boolean; connect(): Promise<unknown> };
};
type BluetoothNavigator = Navigator & {
  bluetooth?: {
    requestDevice(options: { acceptAllDevices: boolean; optionalServices: string[] }): Promise<BluetoothDeviceLike>;
    getDevices?: () => Promise<BluetoothDeviceLike[]>;
  };
};
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function formatDuration(milliseconds: number) {
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function RecordingCard({ item, onDelete }: { item: SavedRecording; onDelete: () => void }) {
  const url = useMemo(() => URL.createObjectURL(item.blob), [item.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <article className="recording-card">
      <video src={url} controls preload="metadata" playsInline />
      <div>
        <strong>{new Date(item.createdAt).toLocaleString()}</strong>
        <small>{formatDuration(item.durationMs)} · stored locally</small>
      </div>
      <button onClick={onDelete}>Delete</button>
    </article>
  );
}

export default function Home() {
  const [position, setPosition] = useState<Position | null>(null);
  const [locationStatus, setLocationStatus] = useState('Waiting for location permission');
  const [devices, setDevices] = useState<NearbyDevice[]>([]);
  const [deviceStatus, setDeviceStatus] = useState('No Bluetooth devices authorized');
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordings, setRecordings] = useState<SavedRecording[]>([]);
  const [search, setSearch] = useState('');
  const [listening, setListening] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, role: 'khan', text: 'KhanTech is live. Tap the voice cloud and ask me to locate you, scan Bluetooth, open the camera, record, or search Google.' },
  ]);

  const previewRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedRef = useRef(0);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<CircleMarker | null>(null);
  const accuracyRef = useRef<Circle | null>(null);

  async function refreshRecordings() {
    try { setRecordings(await listRecordings()); } catch { setRecordings([]); }
  }

  useEffect(() => {
    void refreshRecordings();
    void navigator.storage?.persist?.();
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js');

    const captureInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    window.addEventListener('beforeinstallprompt', captureInstall);

    const bluetooth = (navigator as BluetoothNavigator).bluetooth;
    if (bluetooth?.getDevices) {
      void bluetooth.getDevices().then((authorized) => {
        setDevices(authorized.map((device) => ({ id: device.id, name: device.name || 'Unnamed Bluetooth device', connected: Boolean(device.gatt?.connected) })));
        if (authorized.length) setDeviceStatus(`${authorized.length} previously authorized device${authorized.length === 1 ? '' : 's'}`);
      });
    }

    if (!navigator.geolocation) {
      setLocationStatus('Location is unavailable in this browser');
      return () => window.removeEventListener('beforeinstallprompt', captureInstall);
    }
    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        setPosition({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy, updatedAt: Date.now() });
        setLocationStatus(`Live · accurate to about ${Math.round(coords.accuracy)} m`);
      },
      () => setLocationStatus('Location permission is required for the live map'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.removeEventListener('beforeinstallprompt', captureInstall);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function updateMap() {
      if (!position || !mapElementRef.current) return;
      const L = await import('leaflet');
      if (cancelled) return;
      if (!mapRef.current) {
        mapRef.current = L.map(mapElementRef.current, { zoomControl: false, attributionControl: true })
          .setView([position.lat, position.lng], 14);
        L.control.zoom({ position: 'bottomright' }).addTo(mapRef.current);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(mapRef.current);
      }
      const point: [number, number] = [position.lat, position.lng];
      if (!markerRef.current) {
        markerRef.current = L.circleMarker(point, {
          radius: 9, fillColor: '#d7ff45', fillOpacity: 1, color: '#183d2c', weight: 4,
        }).addTo(mapRef.current).bindTooltip('Your phone · live', { permanent: true, direction: 'top', offset: [0, -9] });
        accuracyRef.current = L.circle(point, { radius: position.accuracy, color: '#183d2c', fillColor: '#d7ff45', fillOpacity: .1, weight: 1 }).addTo(mapRef.current);
      } else {
        markerRef.current.setLatLng(point);
        accuracyRef.current?.setLatLng(point).setRadius(position.accuracy);
      }
      mapRef.current.panTo(point, { animate: true });
    }
    void updateMap();
    return () => { cancelled = true; };
  }, [position]);

  useEffect(() => () => {
    cameraStream?.getTracks().forEach((track) => track.stop());
    mapRef.current?.remove();
    mapRef.current = null;
  }, [cameraStream]);

  function respond(text: string, speak = false) {
    setMessages((current) => [...current, { id: Date.now(), role: 'khan', text }].slice(-10));
    if (speak && !quiet && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.02;
      window.speechSynthesis.speak(utterance);
    }
  }

  async function scanBluetooth() {
    const bluetooth = (navigator as BluetoothNavigator).bluetooth;
    if (!bluetooth) {
      setDeviceStatus('Web Bluetooth needs a supported Chrome or Edge browser');
      respond('This browser cannot scan Bluetooth. Try KhanTech in Chrome or Edge on Android.', true);
      return;
    }
    try {
      setDeviceStatus('Choose a device from the secure browser prompt');
      const device = await bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['battery_service', 'device_information'],
      });
      let connected = false;
      try { await device.gatt?.connect(); connected = Boolean(device.gatt?.connected); } catch { /* The device may decline a connection. */ }
      const item = { id: device.id, name: device.name || 'Unnamed Bluetooth device', connected };
      setDevices((current) => [item, ...current.filter((entry) => entry.id !== item.id)]);
      setDeviceStatus(`${item.name} authorized${connected ? ' and connected' : ''}`);
      respond(`${item.name} is now authorized. Bluetooth does not provide trustworthy map coordinates, so I will not invent a location for it.`, true);
    } catch {
      setDeviceStatus('Scan closed without adding a device');
    }
  }

  async function openCamera() {
    if (cameraStream) return cameraStream;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: true });
      setCameraStream(stream);
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        await previewRef.current.play();
      }
      respond('Camera and microphone are ready on this phone.', true);
      return stream;
    } catch {
      respond('Camera access needs your permission and a secure browser connection.', true);
      return null;
    }
  }

  useEffect(() => {
    if (previewRef.current && cameraStream) {
      previewRef.current.srcObject = cameraStream;
      void previewRef.current.play();
    }
  }, [cameraStream]);

  async function takePhoto() {
    const stream = await openCamera();
    if (!stream || !previewRef.current) return;
    const video = previewRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `khantech-photo-${Date.now()}.jpg`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      respond('Photo captured and saved to your downloads.', true);
    }, 'image/jpeg', .92);
  }

  async function startRecording() {
    if (recording) return;
    const stream = await openCamera();
    if (!stream) return;
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
      await saveRecording(blob, Date.now() - recordingStartedRef.current);
      await refreshRecordings();
      setRecording(false);
      respond('Recording stopped. Playback is ready in your private 24-hour history.', true);
    };
    recordingStartedRef.current = Date.now();
    mediaRecorderRef.current = recorder;
    recorder.start(1000);
    setRecording(true);
    respond('Recording started. KhanTech is using this phone’s camera and microphone.', true);
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
  }

  async function installApp() {
    if (installPrompt) {
      await installPrompt.prompt();
      const result = await installPrompt.userChoice;
      if (result.outcome === 'accepted') setInstallPrompt(null);
      return;
    }
    respond('On Android, open the browser menu and choose “Add to Home screen” or “Install app.”', true);
  }

  function runGoogleSearch(event?: FormEvent) {
    event?.preventDefault();
    const query = search.trim();
    if (!query) return;
    window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank', 'noopener,noreferrer');
    respond(`Opening Google results for ${query}.`);
  }

  function handleCommand(transcript: string) {
    const phrase = transcript.toLowerCase();
    setMessages((current) => [...current, { id: Date.now(), role: 'you', text: transcript }].slice(-10));
    if (phrase.includes('stay quiet') || phrase.includes('be quiet')) { setQuiet(true); respond('Quiet mode is on.'); return; }
    if (phrase.includes('speak again') || phrase.includes('okay speak') || phrase.includes('ok speak')) { setQuiet(false); respond('Voice is back on.'); return; }
    if (phrase.includes('stop recording')) { stopRecording(); return; }
    if (phrase.includes('record')) { void startRecording(); return; }
    if (phrase.includes('take') && (phrase.includes('photo') || phrase.includes('picture'))) { void takePhoto(); return; }
    if (phrase.includes('camera')) { void openCamera(); return; }
    if (phrase.includes('scan') || phrase.includes('bluetooth') || phrase.includes('nearby device')) { void scanBluetooth(); return; }
    if (phrase.includes('where am i') || phrase.includes('locate me') || phrase.includes('my location')) {
      respond(position ? `Your live location is available with about ${Math.round(position.accuracy)} meters of accuracy.` : 'I am still waiting for location permission.', true); return;
    }
    if (phrase.startsWith('search ')) { setSearch(transcript.replace(/^search(?: google)?(?: for)?\s+/i, '')); window.setTimeout(() => window.open(`https://www.google.com/search?q=${encodeURIComponent(transcript.replace(/^search(?: google)?(?: for)?\s+/i, ''))}`, '_blank', 'noopener,noreferrer'), 0); return; }
    respond('I run locally without an API. Try: locate me, scan Bluetooth, open camera, take a photo, start recording, stop recording, or search Google for something.', true);
  }

  function toggleListening() {
    if (listening) { recognitionRef.current?.stop(); return; }
    const voiceWindow = window as typeof window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Recognition = voiceWindow.SpeechRecognition || voiceWindow.webkitSpeechRecognition;
    if (!Recognition) { respond('Voice recognition needs Chrome or Edge. The other controls still work.', true); return; }
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = (event) => handleCommand(event.results[0][0].transcript);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => { setListening(false); respond('I did not catch that. Tap the voice cloud and try again.'); };
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top"><span className="brand-orb"><i/><i/><i/></span><b>KhanTech</b></a>
        <div className="top-actions"><span className="live-pill"><i/> LIVE DATA</span><button onClick={installApp}>Install app</button></div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">PRIVATE · LOCAL · NO API KEY</p>
          <h1>Your world,<br/><em>live and clear.</em></h1>
          <p className="hero-text">KhanTech combines your phone’s live location, permission-authorized Bluetooth, camera, recordings, playback, search, and local voice control.</p>
          <form className="search-box" onSubmit={runGoogleSearch}>
            <span>G</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Google" aria-label="Search Google"/><button>Search</button>
          </form>
          <div className="hero-buttons"><button className="primary" onClick={scanBluetooth}>Scan Bluetooth</button><button onClick={installApp}>Install on phone</button></div>
        </div>

        <div className="map-panel">
          <div className="panel-head"><div><small>OPENSTREETMAP · LIVE</small><strong>Your authorized map</strong></div><span>{position ? '● TRACKING' : '○ WAITING'}</span></div>
          <div ref={mapElementRef} className="live-map"><div className="map-placeholder">Allow location to load the live map</div></div>
          <div className="map-foot"><span>{locationStatus}</span><span>{devices.length} Bluetooth authorized</span></div>
        </div>
      </section>

      <section className="command-section">
        <div className="section-title"><div><p className="eyebrow">LOCAL INTELLIGENCE</p><h2>Talk to KhanTech</h2></div><p>No account, API key, or cloud AI required.</p></div>
        <div className="command-grid">
          <div className="message-screen" aria-live="polite">
            {messages.map((message) => <div className={`message ${message.role}`} key={message.id}><small>{message.role === 'you' ? 'YOU' : 'KHANTECH'}</small><p>{message.text}</p></div>)}
          </div>
          <button className={`voice-orb ${listening ? 'listening' : ''}`} onClick={toggleListening}><span className="cloud"><i/><i/><i/></span><strong>{listening ? 'Listening…' : 'Tap and speak'}</strong><small>{quiet ? 'Quiet mode' : 'Local voice control'}</small></button>
        </div>
      </section>

      <section className="studio-section">
        <div className="section-title"><div><p className="eyebrow">CAMERA & VAULT</p><h2>Capture. Record. Replay.</h2></div><p>Saved only in this browser’s private local storage.</p></div>
        <div className="studio-grid">
          <div className="camera-panel">
            <video ref={previewRef} muted playsInline className={cameraStream ? '' : 'hidden'} />
            {!cameraStream && <div className="camera-empty"><span>◎</span><h3>Camera is off</h3><p>Permission is requested only when you open it.</p></div>}
            {recording && <span className="recording-badge"><i/> RECORDING</span>}
            <div className="camera-controls"><button onClick={openCamera}>Open camera</button><button onClick={takePhoto}>Take photo</button>{recording ? <button className="danger" onClick={stopRecording}>Stop</button> : <button className="primary" onClick={startRecording}>Record</button>}</div>
          </div>
          <div className="vault-panel">
            <div className="vault-head"><div><small>ROLLING HISTORY</small><strong>Last 24 hours</strong></div><b>{recordings.length}</b></div>
            <p>Older clips are removed automatically. Browser storage limits vary by phone; true background recording requires the native Android build.</p>
            <div className="recording-list">
              {recordings.length ? recordings.map((item) => <RecordingCard key={item.id} item={item} onDelete={async () => { await deleteRecording(item.id); await refreshRecordings(); }}/>) : <div className="empty-recordings">No recordings yet. Start the camera, then tap Record.</div>}
            </div>
          </div>
        </div>
      </section>

      <section className="device-section">
        <div className="section-title"><div><p className="eyebrow">PERMISSION-AUTHORIZED</p><h2>Nearby devices</h2></div><button className="primary" onClick={scanBluetooth}>Add device</button></div>
        <p className="device-status">{deviceStatus}</p>
        <div className="devices">
          {devices.length ? devices.map((device) => <article key={device.id}><span className="device-dot"/><div><strong>{device.name}</strong><small>Bluetooth · {device.connected ? 'Connected' : 'Authorized'}</small></div><b>{device.connected ? 'LIVE' : 'READY'}</b></article>) : <div className="empty-devices"><span>⌁</span><div><strong>No authorized devices yet</strong><p>Android and browsers require you to choose each Bluetooth device. Unshared devices cannot be named or placed on a map.</p></div></div>}
        </div>
      </section>

      <footer><div><span className="brand-orb"><i/><i/><i/></span><b>KhanTech</b></div><p>Live data only · local storage · explicit permissions · OpenStreetMap</p></footer>
    </main>
  );
}
