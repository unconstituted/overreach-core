import type { BtCharacteristic, BtDevice, BtServer } from '../../src/devices';

/**
 * A fake Web Bluetooth stack. It implements the same structural interface
 * the browser does, backed by the simulated FTMS peripheral, so the real
 * GATT plumbing (discovery, subscriptions, writes, reconnect) runs in tests.
 */
export class FakeCharacteristic implements BtCharacteristic {
  value: DataView | null = null;
  notifying = false;
  private listeners = new Set<(ev: { target: unknown }) => void>();
  constructor(private onWrite?: (b: Uint8Array) => Promise<void>, private readBytes?: Uint8Array) {}
  async startNotifications() { this.notifying = true; }
  async readValue() { return new DataView((this.readBytes ?? new Uint8Array()).buffer); }
  async writeValueWithResponse(v: Uint8Array) { await this.onWrite?.(v); }
  addEventListener(_t: string, cb: (ev: { target: unknown }) => void) { this.listeners.add(cb); }
  removeEventListener(_t: string, cb: (ev: { target: unknown }) => void) { this.listeners.delete(cb); }
  push(bytes: Uint8Array) {
    if (!this.notifying) return;
    this.value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (const l of [...this.listeners]) l({ target: this });
  }
}

export class FakeDevice implements BtDevice {
  id = 'fake';
  gatt: BtServer;
  connects = 0;
  failConnects = 0;
  private dropListeners = new Set<() => void>();
  chars = new Map<number, Map<number, FakeCharacteristic>>();
  constructor(public name: string) {
    this.gatt = {
      connected: false,
      connect: async () => {
        if (this.failConnects > 0) { this.failConnects--; throw new Error('out of range'); }
        this.connects++;
        this.gatt.connected = true;
        // A reconnect yields fresh characteristic objects with no subscriptions, as in the browser.
        for (const svc of this.chars.values()) for (const ch of svc.values()) ch.notifying = false;
        return this.gatt;
      },
      disconnect: () => { this.gatt.connected = false; },
      getPrimaryService: async (uuid: number) => {
        const svc = this.chars.get(uuid);
        if (!svc) throw new Error(`No service 0x${uuid.toString(16)}`);
        return { getCharacteristic: async (c: number) => {
          const ch = svc.get(c);
          if (!ch) throw new Error(`No characteristic 0x${c.toString(16)}`);
          return ch;
        } };
      },
    };
  }
  addEventListener(_t: string, cb: () => void) { this.dropListeners.add(cb); }
  removeEventListener(_t: string, cb: () => void) { this.dropListeners.delete(cb); }
  drop() {
    this.gatt.connected = false;
    for (const l of [...this.dropListeners]) l();
  }
}

