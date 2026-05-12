import type { RefObject } from 'preact';
import { memo } from 'preact/compat';
import { createPortal } from 'preact/compat';
import { Archive, ArrowUpDown, Check, CheckCheck, FolderInput, Plus, RefreshCw, RotateCcw, Trash2, X } from 'lucide-preact';
import LoadingState from '@/components/LoadingState';
import type { Cipher } from '@/lib/types';
import { t } from '@/lib/i18n';
import {
  CreateTypeIcon,
  getCreateTypeOptions,
  getVaultSortOptions,
  VaultListIcon,
  type SidebarFilter,
  type VaultSortMode,
} from '@/components/vault/vault-page-helpers';

interface VirtualRange {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
}

interface VaultListPanelProps {
  busy: boolean;
  loading: boolean;
  error: string;
  searchInput: string;
  sortMode: VaultSortMode;
  sortMenuOpen: boolean;
  selectedCount: number;
  totalCipherCount: number;
  filteredCiphers: Cipher[];
  visibleCiphers: Cipher[];
  virtualRange: VirtualRange;
  selectedCipherId: string;
  selectedMap: Record<string, boolean>;
  sidebarFilter: SidebarFilter;
  isMobileLayout: boolean;
  mobileFabVisible: boolean;
  createMenuOpen: boolean;
  createMenuRef: RefObject<HTMLDivElement>;
  sortMenuRef: RefObject<HTMLDivElement>;
  listPanelRef: RefObject<HTMLDivElement>;
  onSearchInput: (value: string) => void;
  onClearSearch: () => void;
  onSearchCompositionStart: () => void;
  onSearchCompositionEnd: (value: string) => void;
  onToggleSortMenu: () => void;
  onSelectSortMode: (value: VaultSortMode) => void;
  onSyncVault: () => void;
  onOpenBulkDelete: () => void;
  onSelectDuplicates: () => void;
  onSelectAll: () => void;
  onToggleCreateMenu: () => void;
  onStartCreate: (type: number) => void;
  onBulkRestore: () => void;
  onBulkArchive: () => void;
  onBulkUnarchive: () => void;
  onOpenMove: () => void;
  onClearSelection: () => void;
  onScroll: (top: number) => void;
  onToggleSelected: (cipherId: string, checked: boolean) => void;
  onSelectCipher: (cipherId: string) => void;
  listSubtitle: (cipher: Cipher) => string;
}

interface CipherListItemProps {
  cipher: Cipher;
  selected: boolean;
  checked: boolean;
  subtitle: string;
  onToggleSelected: (cipherId: string, checked: boolean) => void;
  onSelectCipher: (cipherId: string) => void;
}

const CipherListItem = memo(function CipherListItem(props: CipherListItemProps) {
  return (
    <div
      className={`list-item ${props.selected ? 'active' : ''}`}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('.row-check')) return;
        props.onSelectCipher(props.cipher.id);
      }}
    >
      <input
        type="checkbox"
        className="row-check"
        checked={props.checked}
        onClick={(event) => event.stopPropagation()}
        onInput={(e) => props.onToggleSelected(props.cipher.id, (e.currentTarget as HTMLInputElement).checked)}
      />
      <button type="button" className="row-main" onClick={() => props.onSelectCipher(props.cipher.id)}>
        <div className={`list-icon-wrap ${Number(props.cipher.type || 1) === 3 ? 'card-list-icon-wrap' : ''}`}>
          <VaultListIcon cipher={props.cipher} />
        </div>
        <div className="list-text">
          <span className="list-title" title={props.cipher.decName || t('txt_no_name')}>
            <span className="list-title-text">{props.cipher.decName || t('txt_no_name')}</span>
          </span>
          <span className="list-sub" title={props.subtitle}>{props.subtitle}</span>
        </div>
      </button>
    </div>
  );
});

export default function VaultListPanel(props: VaultListPanelProps) {
  const createTypeOptions = getCreateTypeOptions();
  const vaultSortOptions = getVaultSortOptions();
  const createMenu = (
    <div className="create-menu-wrap mobile-fab-wrap" ref={props.createMenuRef}>
      <button
        type="button"
        className="btn btn-primary small mobile-fab-trigger"
        aria-label={t('txt_add')}
        title={t('txt_add')}
        onClick={props.onToggleCreateMenu}
      >
        <Plus size={14} className="btn-icon" />
      </button>
      {props.createMenuOpen && (
        <div className="create-menu">
          {createTypeOptions.map((option) => (
            <button key={option.type} type="button" className="create-menu-item" onClick={() => props.onStartCreate(option.type)}>
              <CreateTypeIcon type={option.type} />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <section className="list-col">
      <div className="list-head">
        <div className="search-input-wrap">
          <input
            className="search-input"
            placeholder={t('txt_search_your_secure_vault')}
            value={props.searchInput}
            onInput={(e) => props.onSearchInput((e.currentTarget as HTMLInputElement).value)}
            onCompositionStart={props.onSearchCompositionStart}
            onCompositionEnd={(e) => props.onSearchCompositionEnd((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape' || !props.searchInput) return;
              e.preventDefault();
              props.onClearSearch();
            }}
          />
          {!!props.searchInput && (
            <button
              type="button"
              className="search-clear-btn"
              aria-label={t('txt_clear_search')}
              title={t('txt_clear_search_esc')}
              onClick={props.onClearSearch}
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="sort-menu-wrap" ref={props.sortMenuRef}>
          <button
            type="button"
            className={`btn btn-secondary small sort-trigger ${props.sortMenuOpen ? 'active' : ''}`}
            aria-label={t('txt_sort')}
            title={t('txt_sort')}
            onClick={props.onToggleSortMenu}
          >
            <ArrowUpDown size={14} className="btn-icon" />
          </button>
          {props.sortMenuOpen && (
            <div className="sort-menu">
              {vaultSortOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`sort-menu-item ${props.sortMode === option.value ? 'active' : ''}`}
                  onClick={() => props.onSelectSortMode(option.value)}
                >
                  <span>{option.label}</span>
                  {props.sortMode === option.value ? <Check size={14} /> : <span className="sort-menu-check-placeholder" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="list-count" title={t('txt_total_items_count', { count: props.totalCipherCount })}>
          {t('txt_total_items_count', { count: props.totalCipherCount })}
        </div>
        <button type="button" className="btn btn-secondary small list-icon-btn" disabled={props.busy || props.loading} onClick={props.onSyncVault}>
          <RefreshCw size={14} className="btn-icon" /> {t('txt_sync_vault')}
        </button>
      </div>
      <div className="toolbar actions">
        {props.sidebarFilter.kind === 'duplicates' && (
          <button type="button" className="btn btn-secondary small" disabled={!props.filteredCiphers.length || props.busy} onClick={props.onSelectDuplicates}>
            <Check size={14} className="btn-icon" /> {t('txt_select_duplicate_items')}
          </button>
        )}
        {props.selectedCount > 0 && props.sidebarFilter.kind === 'trash' && (
          <button type="button" className="btn btn-secondary small" disabled={props.busy} onClick={props.onBulkRestore}>
            <RefreshCw size={14} className="btn-icon" /> {t('txt_restore')}
          </button>
        )}
        {props.selectedCount > 0 && props.sidebarFilter.kind === 'archive' && (
          <button type="button" className="btn btn-secondary small" disabled={props.busy} onClick={props.onBulkUnarchive}>
            <RotateCcw size={14} className="btn-icon" /> {t('txt_unarchive')}
          </button>
        )}
        {props.selectedCount > 0 && props.sidebarFilter.kind !== 'trash' && props.sidebarFilter.kind !== 'archive' && props.sidebarFilter.kind !== 'duplicates' && (
          <button type="button" className="btn btn-secondary small" disabled={props.busy} onClick={props.onBulkArchive}>
            <Archive size={14} className="btn-icon" /> {t('txt_archive_selected')}
          </button>
        )}
        {props.selectedCount > 0 && props.sidebarFilter.kind !== 'trash' && props.sidebarFilter.kind !== 'archive' && props.sidebarFilter.kind !== 'duplicates' && (
          <button type="button" className="btn btn-secondary small" disabled={props.busy} onClick={props.onOpenMove}>
            <FolderInput size={14} className="btn-icon" /> {t('txt_move')}
          </button>
        )}
        {props.selectedCount > 0 && (
          <button type="button" className="btn btn-secondary small" onClick={props.onClearSelection}>
            <X size={14} className="btn-icon" /> {t('txt_cancel')}
          </button>
        )}
        <button type="button" className="btn btn-danger small" disabled={!props.selectedCount || props.busy} onClick={props.onOpenBulkDelete}>
          <Trash2 size={14} className="btn-icon" /> {props.sidebarFilter.kind === 'trash' ? t('txt_delete_permanently') : t('txt_delete_selected')}
        </button>
        <button type="button" className="btn btn-secondary small" disabled={!props.filteredCiphers.length} onClick={props.onSelectAll}>
          <CheckCheck size={14} className="btn-icon" /> {t('txt_select_all')}
        </button>
        {props.isMobileLayout && typeof document !== 'undefined'
          ? props.mobileFabVisible ? createPortal(createMenu, document.body) : null
          : createMenu}
      </div>

      <div className="list-panel" ref={props.listPanelRef} onScroll={(event) => props.onScroll((event.currentTarget as HTMLDivElement).scrollTop)}>
        {props.loading && !props.filteredCiphers.length && <LoadingState lines={7} compact />}
        {!props.loading && !!props.error && !props.filteredCiphers.length && (
          <div className="empty vault-error-state">
            <strong>{props.error}</strong>
            <button type="button" className="btn btn-secondary small" disabled={props.busy} onClick={props.onSyncVault}>
              {t('txt_retry_sync')}
            </button>
          </div>
        )}
        {!!props.filteredCiphers.length && (
          <div style={{ paddingTop: `${props.virtualRange.padTop}px`, paddingBottom: `${props.virtualRange.padBottom}px` }}>
            {props.visibleCiphers.map((cipher) => (
              <CipherListItem
                key={cipher.id}
                cipher={cipher}
                selected={props.selectedCipherId === cipher.id}
                checked={!!props.selectedMap[cipher.id]}
                subtitle={props.listSubtitle(cipher)}
                onToggleSelected={props.onToggleSelected}
                onSelectCipher={props.onSelectCipher}
              />
            ))}
          </div>
        )}
        {!props.loading && !props.error && !props.filteredCiphers.length && <div className="empty">{t('txt_no_items')}</div>}
      </div>
    </section>
  );
}
