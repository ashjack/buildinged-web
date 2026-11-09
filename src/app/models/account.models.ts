export type AccountType = 'normal' | 'contributor' | 'admin';
export const PROTECTED_ADMIN_UID = 'gK0MQfxb5XVs8SGlF1GVKUYXQdK2';
export interface AccountUser {
  uid: string;
  email: string;
  displayName: string;
  type: AccountType;
  revision: number;
  protected: boolean;
}
