import { useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import { validateImageFile } from '../../../lib/validateImage';
import logger from '../../../lib/logger';

/**
 * Reescala y recomprime antes de subir. Mismo patrón que el asistente de alta
 * y que GymSettingsTab, pero a 1200px en vez de 512: esto es una cabecera a
 * ancho completo de correo (600pt, el doble en pantallas retina), no un logo.
 * Sin esto se subiría la foto de 8 MP tal cual y el correo tardaría en cargar
 * justo donde menos paciencia hay.
 */
async function compressImage(file, maxSize = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > height) {
        if (width > maxSize) { height = Math.round((height * maxSize) / width); width = maxSize; }
      } else if (height > maxSize) {
        width = Math.round((width * maxSize) / height); height = maxSize;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => resolve(blob || file), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Failed to load image')); };
    img.src = objectUrl;
  });
}

/**
 * Escoger la imagen de cabecera de un correo: subirla, no pegar una URL.
 *
 * Antes esto era una caja de texto con placeholder `https://...`. Para poner
 * una foto el dueño del gimnasio tenía que subirla a algún sitio por su
 * cuenta, sacar la URL directa —no la de la página, la del archivo— y pegarla
 * aquí. En la práctica nadie lo hace, y quien lo intenta pega el enlace de
 * Google Drive o de Instagram, que no sirve: no es una imagen servida.
 *
 * Sube a `email-assets`, un bucket PÚBLICO a propósito. Los clientes de correo
 * no se autentican, así que una URL firmada caduca y deja el correo con un
 * hueco meses después de enviarlo. La imagen de una campaña no es un dato
 * privado.
 *
 * La ruta lleva el gym_id delante (`${gymId}/${Date.now()}.jpg`) y es única
 * por subida: así el `cacheControl` largo es seguro — una imagen nueva es
 * siempre una URL nueva — y no hay que invalidar nada.
 */
export default function EmailImagePicker({ value, onChange, gymId, t }) {
  const fileRef = useRef(null);
  const { showToast } = useToast();
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file) => {
    if (!file || !gymId) return;
    const validation = await validateImageFile(file);
    if (!validation.valid) {
      showToast(validation.error, 'error');
      return;
    }
    setUploading(true);
    try {
      const compressed = await compressImage(file);
      const path = `${gymId}/${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from('email-assets')
        .upload(path, compressed, { cacheControl: '31536000', upsert: false, contentType: 'image/jpeg' });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('email-assets').getPublicUrl(path);
      if (!data?.publicUrl) throw new Error('No public URL');
      onChange(data.publicUrl);
    } catch (err) {
      logger.error('email hero upload failed', err);
      // El bucket lo crea la migración 0694. Si aún no se aplicó, el error es
      // "Bucket not found" y decir "no se pudo subir" no ayuda a nadie.
      const missingBucket = /bucket not found/i.test(err?.message || '');
      showToast(
        missingBucket
          ? t('admin.emailTemplates.bucketMissing', 'Image storage is not set up yet — apply the pending migration.')
          : t('admin.emailTemplates.uploadFailed', 'Could not upload that image'),
        'error',
      );
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {value ? (
        <div className="overflow-hidden rounded-xl" style={{ border: '1px solid var(--color-admin-border)' }}>
          <img src={value} alt="" style={{ width: '100%', maxHeight: 150, objectFit: 'cover', display: 'block' }} />
          <div className="flex gap-2 p-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors disabled:opacity-50"
              style={{ background: 'var(--color-admin-panel)', color: 'var(--color-admin-text-sub)', border: '1px solid var(--color-admin-border)' }}
            >
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
              {t('admin.emailTemplates.replaceImage', 'Replace')}
            </button>
            <button
              type="button"
              onClick={() => onChange('')}
              disabled={uploading}
              className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors disabled:opacity-50"
              style={{ background: 'var(--color-admin-panel)', color: 'var(--color-danger)', border: '1px solid var(--color-admin-border)' }}
            >
              <Trash2 size={13} /> {t('admin.emailTemplates.removeImage', 'Remove')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || !gymId}
          className="flex w-full items-center justify-center gap-2 rounded-xl transition-colors hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
          style={{ padding: 18, border: '1.5px dashed var(--color-admin-border)', background: 'transparent', color: 'var(--color-admin-text-sub)', fontWeight: 700, fontSize: 13 }}
        >
          {uploading ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}
          {uploading
            ? t('admin.emailTemplates.uploading', 'Uploading…')
            : t('admin.emailTemplates.addImage', 'Add an image')}
        </button>
      )}
    </div>
  );
}
