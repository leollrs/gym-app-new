-- Create storage buckets if they don't exist

insert into storage.buckets (id, name, public)
values ('gym-logos', 'gym-logos', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('progress_photos', 'progress_photos', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- gym-logos: admins can upload their own gym's logo; public read
create policy "gym_logos_admin_upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'gym-logos'
    and (storage.foldername(name))[1] = (
      select gym_id::text from profiles where id = auth.uid() limit 1
    )
    and exists (
      select 1 from profiles
      where id = auth.uid()
      and role in ('admin', 'super_admin')
    )
  );

create policy "gym_logos_public_read"
  on storage.objects for select
  using (bucket_id = 'gym-logos');

create policy "gym_logos_admin_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'gym-logos'
    and exists (
      select 1 from profiles
      where id = auth.uid()
      and role in ('admin', 'super_admin')
    )
  );

-- progress_photos: members can manage their own photos; private bucket
create policy "progress_photos_owner_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'progress_photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "progress_photos_owner_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'progress_photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "progress_photos_owner_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'progress_photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- avatars: members can upload their own avatar; public read
create policy "avatars_owner_upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars_owner_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
