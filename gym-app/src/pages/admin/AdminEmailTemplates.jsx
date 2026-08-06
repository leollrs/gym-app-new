import { useState, useEffect, useMemo, useCallback } from 'react';
import posthogClient from 'posthog-js';
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
import DesignerTemplateModal from './components/DesignerTemplateModal';
import EmailTemplateCard, { PrebuiltCard } from './components/EmailTemplateCard';
import EmailDesignerGallery from './components/EmailDesignerGallery';
import EmailCampaignsTab from './components/EmailCampaignsTab';
import { listDesignerTemplateIds } from '../../lib/admin/emailDesignerTemplates';

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
  const [listTab, setListTab] = useState('designer');

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
            // step_key y auto_enabled tienen que ir aquí. Se quedaron fuera y
            // el efecto era que el flujo principal — abrir una plantilla,
            // asignarle un momento automático, encenderla — escribía NADA y
            // aun así sacaba el toast de éxito. Solo funcionaba al crear, y
            // una automatización encendida no se podía apagar.
            step_key: payload.step_key,
            auto_enabled: payload.auto_enabled,
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
      posthogClient?.capture('admin_template_saved', { kind: 'email' });
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

  // El idioma BASE se sella al CREAR, con el de la interfaz.
  //
  // `defaultTemplate` y las prefabricadas se rellenan con `t(...)`, o sea que su
  // texto sale en el idioma que tenga puesto quien las crea. Sin sellarlo, una
  // plantilla escrita en inglés quedaba etiquetada como española y el enviador
  // se la mandaba en inglés a un miembro que pidió español. Ver emailVariants.js.
  const uiLang = i18n.language?.startsWith('en') ? 'en' : 'es';

  const handleUsePrebuilt = useCallback((prebuilt) => {
    setEditing({
      ...prebuilt,
      lang: uiLang,
      id: 'prebuilt-' + crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }, [uiLang]);

  const handleDuplicate = useCallback((tpl) => {
    setEditing({
      ...JSON.parse(JSON.stringify(tpl)),
      id: 'prebuilt-' + crypto.randomUUID(),
      name: `${tpl.name} (copy)`,
      // Una copia arranca manual. Heredar el momento viola el índice único
      // (gym_id, step_key) WHERE auto_enabled (0687:40-42), así que duplicar
      // una plantilla automática fallaba siempre al guardar; y heredar
      // auto_enabled haría que una copia empezara a enviar sola.
      step_key: null,
      auto_enabled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }, []);

  const handleNewTemplate = useCallback(() => {
    setEditing({ ...defaultTemplate(gymName, primaryColor, t), lang: uiLang });
  }, [gymName, primaryColor, t, uiLang]);

  const sortedTemplates = useMemo(() =>
    [...templates].sort((a, b) => new Date(b.updatedAt || b.updated_at || 0) - new Date(a.updatedAt || a.updated_at || 0)),
    [templates],
  );

  // Ojo con el orden: una plantilla de la galería NO entra en esta rama. Es
  // HTML fijo, no tiene bloques que editar, y guardarla desde el editor de
  // bloques la dejaría en blanco. Se atiende con su propio modal, montado
  // abajo junto a los demás para que la lista siga detrás en vez de quedar la
  // página vacía.
  if (editing && !editing.designer_id) {
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
    { key: 'designer', label: t('admin.emailTemplates.tabDesigner', 'Designs'), count: listDesignerTemplateIds().length },
    { key: 'mine', label: t('admin.emailTemplates.tabMine', 'My Templates'), count: templates.length },
    { key: 'prebuilt', label: t('admin.emailTemplates.tabPrebuilt', 'Prebuilt'), count: prebuiltTemplates.length },
    // Sin `count`: es actividad, no un inventario, y un número al lado del
    // nombre invitaría a leerlo como "cuántas campañas hay".
    { key: 'activity', label: t('admin.emailTemplates.tabActivity', 'Activity') },
  ];

  return (
    <div className="px-4 md:px-8 py-6 pb-28 md:pb-12 max-w-[1600px] mx-auto">
      <PageHeader
        title={t('admin.emailTemplates.title')}
        subtitle={t('admin.emailTemplates.subtitle')}
        actions={
          <button
            onClick={handleNewTemplate}
            className="flex items-center justify-center gap-2 px-5 py-2.5 text-[13px] font-bold transition-all duration-200 hover:brightness-[1.04]"
            style={{
              backgroundColor: 'var(--color-accent)',
              color: '#fff',
              borderRadius: 999,
              boxShadow: '0 2px 10px color-mix(in srgb, var(--color-accent) 32%, transparent)',
            }}
          >
            <Plus size={16} strokeWidth={2.6} /> {t('admin.emailTemplates.createNew')}
          </button>
        }
        className="mb-6"
      />

      <AdminTabs tabs={tabs} active={listTab} onChange={setListTab} className="mb-5" />

      <SwipeableTabContent tabs={tabs} active={listTab} onChange={setListTab}>
        {(tabKey) => {
          if (tabKey === 'designer') return (
            <EmailDesignerGallery gymName={gymName} gymLogoUrl={gymLogoUrl} />
          );
          if (tabKey === 'mine') return (
            <>
              {isLoading ? (
                <AdminCard>
                  <div className="flex items-center justify-center py-8">
                    <Loader2 size={24} className="animate-spin" style={{ color: 'var(--color-admin-text-muted)' }} />
                  </div>
                </AdminCard>
              ) : sortedTemplates.length === 0 ? (
                <AdminCard>
                  <div className="text-center py-12">
                    <Mail size={32} className="mx-auto mb-3" style={{ color: 'var(--color-admin-text-muted)' }} />
                    <p className="text-[14px]" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.emailTemplates.noTemplates')}</p>
                    <p className="text-[12px] mt-1" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.emailTemplates.noTemplatesHint')}</p>
                    <button onClick={handleNewTemplate}
                      className="mt-4 inline-flex items-center justify-center gap-2 px-5 py-2.5 text-[13px] font-bold transition-all duration-200 hover:brightness-[1.04]"
                      style={{ backgroundColor: 'var(--color-accent)', color: '#fff', borderRadius: 999, boxShadow: '0 2px 10px color-mix(in srgb, var(--color-accent) 32%, transparent)' }}>
                      <Plus size={16} strokeWidth={2.6} /> {t('admin.emailTemplates.createNew')}
                    </button>
                  </div>
                </AdminCard>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    {sortedTemplates.map(tpl => (
                      <EmailTemplateCard
                        key={tpl.id}
                        template={tpl}
                        onEdit={setEditing}
                        onDelete={id => setDeleteConfirm(id)}
                        onDuplicate={handleDuplicate}
                        t={t}
                        lang={i18n.language}
                        gymName={gymName}
                      />
                    ))}
                  </div>
                  <button
                    onClick={handleNewTemplate}
                    className="w-full mt-4 flex items-center justify-center gap-2 rounded-2xl transition-colors hover:bg-[var(--color-bg-hover)]"
                    style={{ padding: 18, border: '1.5px dashed var(--color-admin-border)', background: 'transparent', color: 'var(--color-admin-text-sub)', fontWeight: 700, fontSize: 13 }}
                  >
                    <Plus size={16} strokeWidth={2.2} /> {t('admin.emailTemplates.createNewTemplate', 'Create a new template')}
                  </button>
                </>
              )}
            </>
          );
          if (tabKey === 'prebuilt') return (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {prebuiltTemplates.map(tpl => (
                <PrebuiltCard key={tpl.id} template={tpl} onUse={handleUsePrebuilt} t={t} gymName={gymName} />
              ))}
            </div>
          );
          if (tabKey === 'activity') return <EmailCampaignsTab gymId={gymId} />;
          return null;
        }}
      </SwipeableTabContent>

      {editing?.designer_id && (
        <DesignerTemplateModal
          template={editing}
          saving={saveMutation.isPending}
          onSave={handleSave}
          onClose={() => setEditing(null)}
          onDelete={(id) => { setEditing(null); setDeleteConfirm(id); }}
          t={t}
        />
      )}

      {deleteConfirm && (
        <AdminModal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)}>
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <Trash2 size={20} className="text-[#EF4444]" />
            </div>
            <h3 className="text-[16px] font-bold mb-2" style={{ color: 'var(--color-admin-text)' }}>
              {t('admin.emailTemplates.confirmDelete')}
            </h3>
            <p className="text-[13px] mb-6" style={{ color: 'var(--color-admin-text-sub)' }}>
              {t('admin.emailTemplates.confirmDeleteDesc')}
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors hover:bg-[var(--color-bg-hover)]"
                style={{ color: 'var(--color-admin-text-sub)', background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}
              >
                {t('admin.emailTemplates.cancel')}
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 rounded-xl text-[13px] font-bold transition-colors disabled:opacity-50"
                style={{ background: '#EF4444', color: '#fff' }}
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
