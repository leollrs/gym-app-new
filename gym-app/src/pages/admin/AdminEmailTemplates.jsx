import { useState, useEffect, useMemo, useCallback } from 'react';
import { Mail, Plus, Trash2, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { adminKeys } from '../../lib/adminQueryKeys';
import { logAdminAction } from '../../lib/adminAudit';
import { PageHeader, AdminCard, AdminModal, AdminTabs } from '../../components/admin';
import { SwipeableTabContent } from '../../components/admin/AdminTabs';
import { dbRowToTemplate, templateToDbPayload } from '../../lib/admin/emailTemplateRenderer';
import { defaultTemplate, getPrebuiltTemplates } from './components/emailTemplatePrebuilts';
import EmailTemplateEditor from './components/EmailTemplateEditor';
import EmailTemplateCard, { PrebuiltCard } from './components/EmailTemplateCard';

export default function AdminEmailTemplates() {
  const { gymName, gymLogoUrl, profile } = useAuth();
  const { showToast } = useToast();
  const { t, i18n } = useTranslation('pages');
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;

  const primaryColor = useMemo(() => {
    if (typeof document === 'undefined') return '#D4AF37';
    const val = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
    return val || '#D4AF37';
  }, []);

  const [editing, setEditing] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [listTab, setListTab] = useState('mine');

  useEffect(() => { document.title = `${t('admin.emailTemplates.title', 'Admin - Email Templates')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  const { data: dbTemplates = [], isLoading } = useQuery({
    queryKey: adminKeys.emailTemplates(gymId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_email_templates')
        .select('*')
        .eq('gym_id', gymId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(dbRowToTemplate);
    },
    enabled: !!gymId,
  });

  const templates = dbTemplates;

  const saveMutation = useMutation({
    mutationFn: async (tpl) => {
      const payload = templateToDbPayload(tpl, gymId);
      const isExisting = tpl.id && !tpl.id.startsWith('prebuilt-') && templates.some(x => x.id === tpl.id);
      if (isExisting) {
        const { error } = await supabase
          .from('gym_email_templates')
          .update({
            name: payload.name,
            template_type: payload.template_type,
            template_data: payload.template_data,
          })
          .eq('id', tpl.id)
          .eq('gym_id', gymId);
        if (error) throw error;
      } else {
        delete payload.id;
        const { error } = await supabase
          .from('gym_email_templates')
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.emailTemplates(gymId) });
      setEditing(null);
      showToast(t('admin.emailTemplates.templateSaved'), 'success');
    },
    onError: () => {
      showToast(t('admin.emailTemplates.saveFailed'), 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('gym_email_templates')
        .delete()
        .eq('id', id)
        .eq('gym_id', gymId);
      if (error) throw error;
    },
    onSuccess: (_data, id) => {
      logAdminAction('delete_email_template', 'gym_email_template', id);
      queryClient.invalidateQueries({ queryKey: adminKeys.emailTemplates(gymId) });
      setDeleteConfirm(null);
      showToast(t('admin.emailTemplates.templateDeleted'), 'success');
    },
    onError: () => {
      showToast(t('admin.emailTemplates.deleteFailed'), 'error');
    },
  });

  const prebuiltTemplates = useMemo(
    () => getPrebuiltTemplates(gymName, primaryColor, t),
    [gymName, primaryColor, t],
  );

  const handleSave = useCallback((tpl) => saveMutation.mutate(tpl), [saveMutation]);
  const handleDelete = useCallback((id) => deleteMutation.mutate(id), [deleteMutation]);

  const handleUsePrebuilt = useCallback((prebuilt) => {
    setEditing({
      ...prebuilt,
      id: 'prebuilt-' + crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }, []);

  const handleDuplicate = useCallback((tpl) => {
    setEditing({
      ...JSON.parse(JSON.stringify(tpl)),
      id: 'prebuilt-' + crypto.randomUUID(),
      name: `${tpl.name} (copy)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }, []);

  const handleNewTemplate = useCallback(() => {
    setEditing(defaultTemplate(gymName, primaryColor, t));
  }, [gymName, primaryColor, t]);

  const sortedTemplates = useMemo(() =>
    [...templates].sort((a, b) => new Date(b.updatedAt || b.updated_at || 0) - new Date(a.updatedAt || a.updated_at || 0)),
    [templates],
  );

  if (editing) {
    return (
      <div className="min-h-screen">
        <EmailTemplateEditor
          initial={editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
          gymName={gymName}
          gymLogoUrl={gymLogoUrl}
          saving={saveMutation.isPending}
        />
      </div>
    );
  }

  const tabs = [
    { key: 'mine', label: t('admin.emailTemplates.tabMine', 'My Templates'), count: templates.length },
    { key: 'prebuilt', label: t('admin.emailTemplates.tabPrebuilt', 'Prebuilt'), count: prebuiltTemplates.length },
  ];

  return (
    <div className="px-4 md:px-8 py-6 pb-28 md:pb-12 max-w-[1600px] mx-auto">
      <PageHeader
        title={t('admin.emailTemplates.title')}
        subtitle={t('admin.emailTemplates.subtitle')}
        actions={
          <button
            onClick={handleNewTemplate}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-[13px] transition-colors" style={{ backgroundColor: '#D4AF37', color: '#000' }}
          >
            <Plus size={16} /> {t('admin.emailTemplates.createNew')}
          </button>
        }
        className="mb-6"
      />

      <AdminTabs tabs={tabs} active={listTab} onChange={setListTab} className="mb-5" />

      <SwipeableTabContent tabs={tabs} active={listTab} onChange={setListTab}>
        {(tabKey) => {
          if (tabKey === 'mine') return (
            <>
              {isLoading ? (
                <AdminCard>
                  <div className="flex items-center justify-center py-8">
                    <Loader2 size={24} className="animate-spin text-[#6B7280]" />
                  </div>
                </AdminCard>
              ) : sortedTemplates.length === 0 ? (
                <AdminCard>
                  <div className="text-center py-12">
                    <Mail size={32} className="mx-auto text-[#6B7280] mb-3" />
                    <p className="text-[14px] text-[#9CA3AF]">{t('admin.emailTemplates.noTemplates')}</p>
                    <p className="text-[12px] text-[#6B7280] mt-1">{t('admin.emailTemplates.noTemplatesHint')}</p>
                    <button onClick={handleNewTemplate}
                      className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold text-black bg-[#D4AF37] hover:brightness-90 transition-colors">
                      <Plus size={14} /> {t('admin.emailTemplates.createNew')}
                    </button>
                  </div>
                </AdminCard>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 md:gap-3">
                  {sortedTemplates.map(tpl => (
                    <EmailTemplateCard
                      key={tpl.id}
                      template={tpl}
                      onEdit={setEditing}
                      onDelete={id => setDeleteConfirm(id)}
                      onDuplicate={handleDuplicate}
                      t={t}
                      lang={i18n.language}
                    />
                  ))}
                </div>
              )}
            </>
          );
          if (tabKey === 'prebuilt') return (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {prebuiltTemplates.map(tpl => (
                <PrebuiltCard key={tpl.id} template={tpl} onUse={handleUsePrebuilt} t={t} />
              ))}
            </div>
          );
          return null;
        }}
      </SwipeableTabContent>

      {deleteConfirm && (
        <AdminModal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)}>
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <Trash2 size={20} className="text-[#EF4444]" />
            </div>
            <h3 className="text-[16px] font-bold text-[#E5E7EB] mb-2">
              {t('admin.emailTemplates.confirmDelete')}
            </h3>
            <p className="text-[13px] text-[#9CA3AF] mb-6">
              {t('admin.emailTemplates.confirmDeleteDesc')}
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 rounded-xl text-[13px] font-semibold text-[#9CA3AF] bg-white/[0.04] border border-white/8 hover:bg-white/[0.08] transition-colors"
              >
                {t('admin.emailTemplates.cancel')}
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 rounded-xl text-[13px] font-bold text-white bg-[#EF4444] hover:bg-[#DC2626] transition-colors disabled:opacity-50"
              >
                {deleteMutation.isPending ? <Loader2 size={15} className="animate-spin inline mr-1" /> : null}
                {t('admin.emailTemplates.deleteConfirm')}
              </button>
            </div>
          </div>
        </AdminModal>
      )}
    </div>
  );
}
