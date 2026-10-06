/**
 * Tiny WebRTC file transfer between two of the user's own devices.
 *
 * The server only relays signaling (SDP/ICE); the bytes go peer-to-peer over a
 * data channel. Both devices must have Botifyr open.
 */

const DEFAULT_ICE: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

// Overridable at runtime from /v1/config, so a TURN relay can be added for
// strict NAT without a rebuild.
let iceConfig: RTCConfiguration = DEFAULT_ICE;

/** Replace the ICE servers (e.g. add a TURN relay from the server config). */
export function setIceServers(servers: RTCIceServer[]): void {
  iceConfig = { iceServers: servers.length > 0 ? servers : DEFAULT_ICE.iceServers };
}

export interface P2PHandlers {
  /** Relay a signaling payload (SDP/ICE) to a peer device. */
  signal: (to: string, data: unknown) => void;
  /** A file finished arriving. */
  onFile: (name: string, blob: Blob) => void;
}

interface Incoming {
  name: string;
  size: number;
  chunks: Uint8Array[];
}

export class P2P {
  private peers = new Map<string, RTCPeerConnection>();
  private incoming = new Map<string, Incoming>();

  constructor(private readonly handlers: P2PHandlers) {}

  /** Offer `blob` to another device (by its device id). */
  async sendFile(peer: string, name: string, blob: Blob): Promise<void> {
    const pc = new RTCPeerConnection(iceConfig);
    this.peers.set(peer, pc);
    const channel = pc.createDataChannel("file");
    channel.binaryType = "arraybuffer";

    channel.onopen = () => {
      channel.send(JSON.stringify({ kind: "meta", name, size: blob.size }));
      const reader = blob.stream().getReader();
      const pump = (): void => {
        void reader.read().then(({ done, value }) => {
          if (done) {
            channel.send(JSON.stringify({ kind: "end" }));
            return;
          }
          if (!value) return pump();
          channel.send(value);
          pump();
        });
      };
      pump();
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) this.handlers.signal(peer, { candidate: event.candidate });
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.handlers.signal(peer, { sdp: pc.localDescription });
  }

  /** Handle signaling from a peer device. */
  async handleSignal(from: string, data: unknown): Promise<void> {
    const payload = data as { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
    let pc = this.peers.get(from);
    if (!pc) {
      pc = new RTCPeerConnection(iceConfig);
      this.peers.set(from, pc);
      pc.onicecandidate = (event) => {
        if (event.candidate) this.handlers.signal(from, { candidate: event.candidate });
      };
      pc.ondatachannel = (event) => this.wireChannel(from, event.channel);
    }
    if (payload.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      if (payload.sdp.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.handlers.signal(from, { sdp: pc.localDescription });
      }
    } else if (payload.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
    }
  }

  private wireChannel(from: string, channel: RTCDataChannel): void {
    channel.binaryType = "arraybuffer";
    channel.onmessage = (event) => {
      const data = event.data;
      if (typeof data === "string") {
        const meta = JSON.parse(data) as { kind: string; name?: string; size?: number };
        if (meta.kind === "meta") {
          this.incoming.set(from, { name: meta.name ?? "file", size: meta.size ?? 0, chunks: [] });
        } else if (meta.kind === "end") {
          const received = this.incoming.get(from);
          this.incoming.delete(from);
          if (received) this.handlers.onFile(received.name, new Blob(received.chunks as BlobPart[]));
          this.peers.get(from)?.close();
          this.peers.delete(from);
        }
        return;
      }
      const received = this.incoming.get(from);
      if (received && data instanceof ArrayBuffer) received.chunks.push(new Uint8Array(data));
    };
  }
}

/** A stable per-install device id. */
export function deviceId(): string {
  const key = "botifyr.deviceId";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

/** Save a received file to the user's downloads folder. */
export function saveBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
