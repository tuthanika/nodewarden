import { useMemo } from 'preact/hooks';
import { createInvite, deleteAllInvites, deleteInvalidInvites, deleteInvite, deleteUser, setUserStatus } from '@/lib/api/admin';
import { t } from '@/lib/i18n';
import type { AppConfirmState } from '@/components/AppGlobalOverlays';
import type { AuthedFetch } from '@/lib/api/shared';

type Notify = (type: 'success' | 'error' | 'warning', text: string) => void;

interface UseAdminActionsOptions {
  authedFetch: AuthedFetch;
  onNotify: Notify;
  onSetConfirm: (next: AppConfirmState | null) => void;
  refetchUsers: () => Promise<unknown>;
  refetchInvites: () => Promise<unknown>;
}

export default function useAdminActions(options: UseAdminActionsOptions) {
  const { authedFetch, onNotify, onSetConfirm, refetchUsers, refetchInvites } = options;

  return useMemo(
    () => ({
      refreshAdmin() {
        void Promise.all([refetchUsers(), refetchInvites()]).catch((error) => {
          onNotify('error', error instanceof Error ? error.message : t('txt_load_admin_data_failed'));
        });
      },

      async createInvite(hours: number) {
        try {
          await createInvite(authedFetch, hours);
          await refetchInvites();
          onNotify('success', t('txt_invite_created'));
        } catch (error) {
          onNotify('error', error instanceof Error ? error.message : t('txt_create_invite_failed'));
        }
      },

      async toggleUserStatus(userId: string, status: 'active' | 'banned') {
        try {
          await setUserStatus(authedFetch, userId, status === 'active' ? 'banned' : 'active');
          await refetchUsers();
          onNotify('success', t('txt_user_status_updated'));
        } catch (error) {
          onNotify('error', error instanceof Error ? error.message : t('txt_update_user_status_failed'));
        }
      },

      async deleteInvite(code: string) {
        onSetConfirm({
          title: t('txt_delete_invite'),
          message: t('txt_delete_invite_confirm_message'),
          danger: true,
          onConfirm: () => {
            onSetConfirm(null);
            void (async () => {
              try {
                await deleteInvite(authedFetch, code);
                await refetchInvites();
                onNotify('success', t('txt_invite_deleted'));
              } catch (error) {
                onNotify('error', error instanceof Error ? error.message : t('txt_delete_invite_failed'));
              }
            })();
          },
        });
      },

      async deleteInvalidInvites() {
        onSetConfirm({
          title: t('txt_delete_invalid_invites'),
          message: t('txt_delete_invalid_invites_confirm_message'),
          danger: true,
          onConfirm: () => {
            onSetConfirm(null);
            void (async () => {
              try {
                await deleteInvalidInvites(authedFetch);
                await refetchInvites();
                onNotify('success', t('txt_invalid_invites_deleted'));
              } catch (error) {
                onNotify('error', error instanceof Error ? error.message : t('txt_delete_invalid_invites_failed'));
              }
            })();
          },
        });
      },

      async deleteAllInvites() {
        onSetConfirm({
          title: t('txt_delete_all_invites'),
          message: t('txt_delete_all_invite_codes_active_inactive'),
          danger: true,
          onConfirm: () => {
            onSetConfirm(null);
            void (async () => {
              try {
                await deleteAllInvites(authedFetch);
                await refetchInvites();
                onNotify('success', t('txt_all_invites_deleted'));
              } catch (error) {
                onNotify('error', error instanceof Error ? error.message : t('txt_delete_all_invites_failed'));
              }
            })();
          },
        });
      },

      async deleteUser(userId: string) {
        onSetConfirm({
          title: t('txt_delete_user'),
          message: t('txt_delete_this_user_and_all_user_data'),
          danger: true,
          onConfirm: () => {
            onSetConfirm(null);
            void (async () => {
              try {
                await deleteUser(authedFetch, userId);
                await refetchUsers();
                onNotify('success', t('txt_user_deleted'));
              } catch (error) {
                onNotify('error', error instanceof Error ? error.message : t('txt_delete_user_failed'));
              }
            })();
          },
        });
      },
    }),
    [authedFetch, onNotify, onSetConfirm, refetchInvites, refetchUsers]
  );
}
