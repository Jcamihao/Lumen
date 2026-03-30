import { Injectable, signal } from "@angular/core";

@Injectable({ providedIn: "root" })
export class NetworkService {
  private readonly onlineSignal = signal(this.readInitialOnlineState());

  readonly isOnline = this.onlineSignal.asReadonly();

  constructor() {
    if (typeof window === "undefined") {
      return;
    }

    window.addEventListener("online", () => this.onlineSignal.set(true));
    window.addEventListener("offline", () => this.onlineSignal.set(false));
  }

  private readInitialOnlineState() {
    if (typeof navigator === "undefined") {
      return true;
    }

    return navigator.onLine;
  }
}
