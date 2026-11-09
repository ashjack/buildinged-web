import { Injectable, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import type { FirebaseOptions } from 'firebase/app';
import type { Auth, User } from 'firebase/auth';
import { AccountType, PROTECTED_ADMIN_UID } from '../models/account.models';

interface BrowserConfig {
  firebase: FirebaseOptions;
  apiBaseUrl: string;
  adminApiBaseUrl?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly userSubject = new BehaviorSubject<User | null>(null);
  readonly user$ = this.userSubject.asObservable();
  private auth?: Auth;
  private config?: BrowserConfig;
  accountType: AccountType = 'normal';
  private profileGeneration = 0;
  error = '';
  busy = false;

  constructor(private http: HttpClient, private zone: NgZone) { }

  get user(): User | null { return this.userSubject.value; }
  get isAdmin(): boolean { return !!this.user && (this.user.uid === PROTECTED_ADMIN_UID || this.accountType === 'admin'); }
  get canViewWorlds(): boolean { return !!this.user && (this.isAdmin || this.accountType === 'contributor'); }
  async refreshAccount(): Promise<void> { await this.loadAccount(this.user); }
  private async loadAccount(user: User | null): Promise<void> {
    const generation = ++this.profileGeneration;
    if (user?.uid !== this.user?.uid) {
      this.zone.run(() => { this.accountType = 'normal'; this.userSubject.next(null); });
    }
    let type: AccountType = user?.uid === PROTECTED_ADMIN_UID ? 'admin' : 'normal';
    if (user) {
      try {
        const result = await firstValueFrom(this.http.get<{ type: AccountType }>(`${this.apiBaseUrl}/account`, {
          headers: { Authorization: `Bearer ${await user.getIdToken()}` }
        }));
        if (['normal', 'contributor', 'admin'].includes(result.type)) type = result.type;
      } catch { this.error = 'Account permissions could not be loaded. Refresh to retry.'; }
    }
    if (generation !== this.profileGeneration) return;
    this.zone.run(() => {
      const changed = this.accountType !== type || this.user !== user;
      this.accountType = type;
      if (changed) this.userSubject.next(user);
    });
  }
  get apiBaseUrl(): string {
    if (!this.config) throw new Error('Firebase configuration is unavailable.');
    return this.config.apiBaseUrl.replace(/\/$/, '');
  }
  get adminApiBaseUrl(): string {
    if (!this.config) throw new Error('Firebase configuration is unavailable.');
    return (this.config.adminApiBaseUrl || this.apiBaseUrl.replace(/\/workspaceApi$/, '/adminApi')).replace(/\/$/, '');
  }

  async initialize(): Promise<void> {
    try {
      const config = await firstValueFrom(this.http.get<BrowserConfig>('assets/firebase-config.json'));
      if (!config.firebase?.apiKey || !config.firebase.projectId || !config.apiBaseUrl) {
        throw new Error('Firebase browser configuration is incomplete.');
      }
      const [{ initializeApp }, { getAuth, onAuthStateChanged }] =
        await Promise.all([import('firebase/app'), import('firebase/auth')]);
      this.config = config;
      this.auth = getAuth(initializeApp(config.firebase));
      await new Promise<void>((resolve, reject) => {
        onAuthStateChanged(this.auth!, user => {
          void this.loadAccount(user).finally(resolve);
        }, reject);
      });
      window.addEventListener('focus', () => { if (this.user) void this.refreshAccount(); });
    } catch (error) {
      this.error = 'Google sign-in is unavailable. Run npm run configure:firebase and check the Firebase setup.';
      console.error(this.error, error);
    }
  }

  async signIn(): Promise<void> {
    if (!this.auth) {
      this.error = 'Google sign-in is unavailable. Check the Firebase setup.';
      return;
    }
    this.busy = true;
    this.error = '';
    try {
      const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(this.auth, provider);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Google sign-in failed.';
      console.error('Google sign-in failed.', error);
    } finally { this.busy = false; }
  }

  async signOut(): Promise<void> {
    if (!this.auth) throw new Error('Authentication is unavailable.');
    const { signOut } = await import('firebase/auth');
    await signOut(this.auth);
  }

  async token(): Promise<string> {
    if (!this.user) throw new Error('Sign in with Google to access projects.');
    return this.user.getIdToken();
  }
}
