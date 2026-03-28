-- 0104: Populate Spanish names for remaining 353 food items

UPDATE food_items SET name_es = CASE id
  WHEN '8033c068-cc3a-4d12-b537-5713eea081aa' THEN 'Combo de 3 Dedos'
  WHEN 'ca390fe7-6a8d-4934-8e0b-6b7c74605a22' THEN 'Solomillo Outback Special de 6 oz'
  WHEN 'b66da5d9-8352-4720-9d4a-449efed73023' THEN 'Solomillo de 6 oz'
  WHEN '0f6f8af9-1616-46d8-a66b-4d956d5a85c5' THEN 'Açaí Bowl'
  WHEN '169df1ee-4ed5-4dd5-9e16-556aabc20d0d' THEN 'Açaí Bowl'
  WHEN '4a3fb882-c0ce-4906-bb1a-7c2216890201' THEN 'Calabaza Bellota (asada)'
  WHEN 'fd2fb14d-9231-4b8b-93e0-3fb42d4a7369' THEN 'Festín del Almirante'
  WHEN '8cc48c9e-7728-4044-b053-bbb5ca189445' THEN 'Ají de Gallina'
  WHEN '1773ba05-f2c5-457e-93d5-b56e2ccf2099' THEN 'Ajiaco Colombiano'
  WHEN 'd60288fd-66dd-4128-8dad-5b96dc784e05' THEN 'Anticuchos (Brochetas de Corazón de Res, 3)'
  WHEN '10c5f02b-5901-4ffe-a83b-c73b43854a58' THEN 'Tarta de Manzana'
  WHEN '6149ccc0-2fb9-48f0-be17-8ff2a2e3cb0c' THEN 'Arepa Colombiana'
  WHEN 'e90e668f-55f5-4d87-b097-0b8568610bb5' THEN 'Rúcula (cruda)'
  WHEN '06df845b-e2b5-4aee-9c5c-f3ab8295dd00' THEN 'Ashwagandha (600mg)'
  WHEN '85b7f965-50e7-4239-aacb-c4e320492b42' THEN 'Caballa del Atlántico (horneada)'
  WHEN 'a78ada6f-da50-49ba-a199-b6cce2ed43ee' THEN 'Tostada de Aguacate'
  WHEN '438f3962-8a50-4eca-8177-46bbf95ca87d' THEN 'Costillas Baby Back (Media Rack)'
  WHEN '142d4b9f-e0ee-448c-92d6-8d0d6141a9b2' THEN 'Mini Queso Babybel'
  WHEN '6939556b-6fe3-441f-9f4e-3d1308d3af6c' THEN 'Bacon, Huevo y Queso en Brioche'
  WHEN '832310a9-b8ae-43e3-aa3e-3a8d49f5910b' THEN 'Omelette de Bacon'
  WHEN '7e3e2012-2910-46cc-8511-7404f4b4051e' THEN 'Bagel con Salmón Ahumado y Queso Crema'
  WHEN '52d8a523-b740-4cdd-bc90-9f4d4f6f50f7' THEN 'Baklava (2 piezas)'
  WHEN 'f858fef0-07df-4447-80f2-2cb570919434' THEN 'Bandeja Paisa'
  WHEN '9f605721-65b1-4927-b62f-ba98a668b69c' THEN 'Bánh Mì Sandwich'
  WHEN '68a08d12-1ddc-4990-99a8-f8c5b701a0ad' THEN 'Barra Barebells Chocolate Dough'
  WHEN 'a699feb4-ee59-45f1-ac16-c871c7fbafd7' THEN 'Beach Club'
  WHEN 'e4a3d646-e1b0-4580-a9b4-caab27c6ce1c' THEN 'Beignets (3)'
  WHEN '886948b5-7e31-4470-bb03-a2a5866e0bcc' THEN 'Waffle Belga'
  WHEN 'cb297df0-f408-4476-83f9-941e8efec000' THEN 'Bowl de Smoothie de Frutos Rojos'
  WHEN '17f9fb8f-49dd-4317-aecf-56ba80d43b74' THEN 'Big Buford Doble con Queso'
  WHEN '4b485077-37cc-4cb9-b81f-87e8f42f0b5d' THEN 'Omelette Big Steak'
  WHEN 'df5e59ef-f835-4c8b-9db5-11a6b8bda62a' THEN 'Tacos de Birria (3)'
  WHEN '628d7c4c-aa24-459d-8b39-7ed1b38b55ee' THEN 'Galletas con Salsa Gravy'
  WHEN 'e31b7753-69fa-4410-a33a-0434de815b98' THEN 'Naranja Sanguina'
  WHEN '3f493ecd-9c3a-4d78-b731-0cddb09b0299' THEN 'Bloomin'' Onion'
  WHEN '887a07c4-d3a9-4617-85ec-b929da5912b6' THEN 'Sándwich BLT'
  WHEN '81ac089f-826f-4707-93bc-dbc8e6fa40e6' THEN 'Sub BLT (Regular)'
  WHEN '1a2b5772-54a2-4a80-999a-da9968c5bcea' THEN 'Queso Azul (desmenuzado)'
  WHEN 'ef2eb707-91c4-4349-b622-a1c4b9c7807c' THEN 'Bok Choy (cocido)'
  WHEN 'f12c79cd-b949-4d3c-ae8d-5a874fe44339' THEN 'Alitas con Hueso (6 pc)'
  WHEN '63dbe052-47cc-400d-a3f9-ccf4a10bb62d' THEN 'Alitas sin Hueso (6 pc)'
  WHEN '89a7f4c7-4d9a-411d-af26-24b48363f8e4' THEN 'Box Combo'
  WHEN '87448054-4443-4ce9-aa2b-ddc5b19c1260' THEN 'Quesadilla de Desayuno'
  WHEN 'a2f80020-db6a-4369-96d2-64de612e5183' THEN 'Queso Brie'
  WHEN '344f5d79-03e4-4a52-9b40-34faa9dd6bf3' THEN 'Brigadeiro (2 pc)'
  WHEN '08e44591-111a-4ce8-becc-387622739249' THEN 'Sopa de Brócoli con Cheddar (Bowl de Pan)'
  WHEN '28d0a50b-a6f7-4208-89c4-65128b6c10b8' THEN 'Sopa de Brócoli con Cheddar (Taza)'
  WHEN '54b3e0f1-30df-45ca-a862-5e5dd18c6b2e' THEN 'Batido de Proteína BSN Syntha-6'
  WHEN '38c74009-9073-4f76-b3cc-4f913fe641d1' THEN 'Built Bar Chocolate'
  WHEN '4006624e-83c2-49cc-bc6d-4759ddd1e2a3' THEN 'Bún Bò Huế'
  WHEN '1a5885bb-567b-4e8e-961e-54c0ff19eecc' THEN 'Bún Chả'
  WHEN 'c8a773d2-99d3-488c-9da9-5a43e068265e' THEN 'ButterBurger (Single)'
  WHEN 'f1d321ad-30a8-441a-a768-ab4c019aa64b' THEN 'Galleta de Buttermilk'
  WHEN '24f5ba1b-6dfc-462d-9b7a-a4bb1c99d472' THEN 'Calabaza Butternut (asada)'
  WHEN '3f377114-9307-40b1-8345-3eae9ea15e96' THEN 'Cachapas'
  WHEN 'd70b2f9e-613e-40c2-9bd5-780c8f0588e6' THEN 'Caniac Combo'
  WHEN 'fc93d2d6-d2e5-4eb7-8ff2-4cf3689ada79' THEN 'Cap''n Crunch'
  WHEN '4494b975-1a3c-4691-bc55-41b234dbea79' THEN 'Caraotas Negras'
  WHEN 'ce1a596a-32eb-42f9-b154-e7bbef8a3147' THEN 'Plato de Carne Asada'
  WHEN 'b3ed163c-2da3-492e-a062-2f6d08c69b72' THEN 'Causa Limeña'
  WHEN 'e8043488-d3a0-4e35-a5c2-7d1d61aa486c' THEN 'Ceviche Peruano'
  WHEN '03ed3e82-4f0a-4a8c-84d3-8b223fa359d5' THEN 'Chana Masala'
  WHEN 'da0f5505-0465-4801-b828-fe591e810b0d' THEN 'Changua (Sopa de Leche Colombiana)'
  WHEN '350f70df-6ef4-47ec-b0ba-1e21542238a8' THEN 'Chè Ba Màu'
  WHEN '5cd6376b-fa90-4e44-83a6-39ab275843cd' THEN 'Galleta Cheddar Bay'
  WHEN '8a047eac-8c09-4060-9478-a00b53404962' THEN 'Papas Fritas con Queso'
  WHEN 'f088a7ea-5ccb-4431-9766-27c85ac080fd' THEN 'Cherry Limeade (Medium)'
  WHEN '49f06ea4-8e6b-420f-8947-91c18ca76b8c' THEN 'Chick''n Shack'
  WHEN '8c2f7430-3970-4862-bcf1-8d8a85d0330e' THEN 'Pollo y Waffles'
  WHEN 'cbf9f3c0-2ecd-4752-9ed9-577803ef95bc' THEN 'Chicken Adobo (Filipino)'
  WHEN '50adef9e-4ec1-4aac-b397-98d12db3def8' THEN 'Chicken Biryani'
  WHEN '71f59022-8a9a-442a-8e48-a75cb633e524' THEN 'Ensalada César con Pollo'
  WHEN '7f5f5d36-6ed4-4ab3-82ed-7782a0342836' THEN 'Plato de Chicken Fingerz'
  WHEN '2b490859-7f37-4d0c-a549-2c84e9b383c9' THEN 'Pollo Frito Empanizado'
  WHEN '88a15c3b-5702-42e4-8e0a-e7d31521b102' THEN 'Sopa de Pollo con Fideos'
  WHEN '09eb094a-9eb6-413f-85b4-b0ba6851c21d' THEN 'Canasta de Tiras de Pollo (4 pc)'
  WHEN 'a945386e-6190-499a-bf21-682612eb6a9e' THEN 'Chilaquiles Rojos'
  WHEN 'ed25393b-7d61-4862-93e6-774caa285344' THEN 'Salsa Chimichurri'
  WHEN '222d13c8-7791-48e1-bfc8-a4db60afb045' THEN 'Galleta con Chispas de Chocolate'
  WHEN 'e8eb3695-3d5c-4efa-ab3e-f50955f51e65' THEN 'Leche con Chocolate (8 oz)'
  WHEN 'bb18d65e-40ac-4ad1-927c-16b10e7bb8d0' THEN 'Malteada de Chocolate (Medium)'
  WHEN '731781b1-d8c2-4dd4-b648-8e7acdc63261' THEN 'Churrasco Picanha'
  WHEN '8fd70d35-3058-40c6-a67b-0eada104cbbd' THEN 'Churros (3)'
  WHEN 'c6c27ef3-ea84-4cad-80ac-b29b961d787b' THEN 'Bagel de Canela Crunch'
  WHEN 'afce2b5d-7702-4272-9573-66d773253270' THEN 'Waffle Clásico'
  WHEN '3992dc7a-1722-455e-9544-f7403c23b6e6' THEN 'Sándwich Club'
  WHEN '290c2aa7-b3bc-4cab-b716-93f8fc22ff26' THEN 'Sub Club (Regular)'
  WHEN '06edc1bf-c525-49fd-a0f3-f7e796ced083' THEN 'Cocoa Puffs'
  WHEN '6a19a17e-bcae-4918-aa0a-8de06425ab0f' THEN 'Agua de Coco'
  WHEN '76e42e55-9b93-4c9a-ba88-bde3b00ee1b9' THEN 'Péptidos de Colágeno'
  ELSE name_es
END
WHERE id IN (
  '8033c068-cc3a-4d12-b537-5713eea081aa',
  'ca390fe7-6a8d-4934-8e0b-6b7c74605a22',
  'b66da5d9-8352-4720-9d4a-449efed73023',
  '0f6f8af9-1616-46d8-a66b-4d956d5a85c5',
  '169df1ee-4ed5-4dd5-9e16-556aabc20d0d',
  '4a3fb882-c0ce-4906-bb1a-7c2216890201',
  'fd2fb14d-9231-4b8b-93e0-3fb42d4a7369',
  '8cc48c9e-7728-4044-b053-bbb5ca189445',
  '1773ba05-f2c5-457e-93d5-b56e2ccf2099',
  'd60288fd-66dd-4128-8dad-5b96dc784e05',
  '10c5f02b-5901-4ffe-a83b-c73b43854a58',
  '6149ccc0-2fb9-48f0-be17-8ff2a2e3cb0c',
  'e90e668f-55f5-4d87-b097-0b8568610bb5',
  '06df845b-e2b5-4aee-9c5c-f3ab8295dd00',
  '85b7f965-50e7-4239-aacb-c4e320492b42',
  'a78ada6f-da50-49ba-a199-b6cce2ed43ee',
  '438f3962-8a50-4eca-8177-46bbf95ca87d',
  '142d4b9f-e0ee-448c-92d6-8d0d6141a9b2',
  '6939556b-6fe3-441f-9f4e-3d1308d3af6c',
  '832310a9-b8ae-43e3-aa3e-3a8d49f5910b',
  '7e3e2012-2910-46cc-8511-7404f4b4051e',
  '52d8a523-b740-4cdd-bc90-9f4d4f6f50f7',
  'f858fef0-07df-4447-80f2-2cb570919434',
  '9f605721-65b1-4927-b62f-ba98a668b69c',
  '68a08d12-1ddc-4990-99a8-f8c5b701a0ad',
  'a699feb4-ee59-45f1-ac16-c871c7fbafd7',
  'e4a3d646-e1b0-4580-a9b4-caab27c6ce1c',
  '886948b5-7e31-4470-bb03-a2a5866e0bcc',
  'cb297df0-f408-4476-83f9-941e8efec000',
  '17f9fb8f-49dd-4317-aecf-56ba80d43b74',
  '4b485077-37cc-4cb9-b81f-87e8f42f0b5d',
  'df5e59ef-f835-4c8b-9db5-11a6b8bda62a',
  '628d7c4c-aa24-459d-8b39-7ed1b38b55ee',
  'e31b7753-69fa-4410-a33a-0434de815b98',
  '3f493ecd-9c3a-4d78-b731-0cddb09b0299',
  '887a07c4-d3a9-4617-85ec-b929da5912b6',
  '81ac089f-826f-4707-93bc-dbc8e6fa40e6',
  '1a2b5772-54a2-4a80-999a-da9968c5bcea',
  'ef2eb707-91c4-4349-b622-a1c4b9c7807c',
  'f12c79cd-b949-4d3c-ae8d-5a874fe44339',
  '63dbe052-47cc-400d-a3f9-ccf4a10bb62d',
  '89a7f4c7-4d9a-411d-af26-24b48363f8e4',
  '87448054-4443-4ce9-aa2b-ddc5b19c1260',
  'a2f80020-db6a-4369-96d2-64de612e5183',
  '344f5d79-03e4-4a52-9b40-34faa9dd6bf3',
  '08e44591-111a-4ce8-becc-387622739249',
  '28d0a50b-a6f7-4208-89c4-65128b6c10b8',
  '54b3e0f1-30df-45ca-a862-5e5dd18c6b2e',
  '38c74009-9073-4f76-b3cc-4f913fe641d1',
  '4006624e-83c2-49cc-bc6d-4759ddd1e2a3',
  '1a5885bb-567b-4e8e-961e-54c0ff19eecc',
  'c8a773d2-99d3-488c-9da9-5a43e068265e',
  'f1d321ad-30a8-441a-a768-ab4c019aa64b',
  '24f5ba1b-6dfc-462d-9b7a-a4bb1c99d472',
  '3f377114-9307-40b1-8345-3eae9ea15e96',
  'd70b2f9e-613e-40c2-9bd5-780c8f0588e6',
  'fc93d2d6-d2e5-4eb7-8ff2-4cf3689ada79',
  '4494b975-1a3c-4691-bc55-41b234dbea79',
  'ce1a596a-32eb-42f9-b154-e7bbef8a3147',
  'b3ed163c-2da3-492e-a062-2f6d08c69b72',
  'e8043488-d3a0-4e35-a5c2-7d1d61aa486c',
  '03ed3e82-4f0a-4a8c-84d3-8b223fa359d5',
  'da0f5505-0465-4801-b828-fe591e810b0d',
  '350f70df-6ef4-47ec-b0ba-1e21542238a8',
  '5cd6376b-fa90-4e44-83a6-39ab275843cd',
  '8a047eac-8c09-4060-9478-a00b53404962',
  'f088a7ea-5ccb-4431-9766-27c85ac080fd',
  '49f06ea4-8e6b-420f-8947-91c18ca76b8c',
  '8c2f7430-3970-4862-bcf1-8d8a85d0330e',
  'cbf9f3c0-2ecd-4752-9ed9-577803ef95bc',
  '50adef9e-4ec1-4aac-b397-98d12db3def8',
  '71f59022-8a9a-442a-8e48-a75cb633e524',
  '7f5f5d36-6ed4-4ab3-82ed-7782a0342836',
  '2b490859-7f37-4d0c-a549-2c84e9b383c9',
  '88a15c3b-5702-42e4-8e0a-e7d31521b102',
  '09eb094a-9eb6-413f-85b4-b0ba6851c21d',
  'a945386e-6190-499a-bf21-682612eb6a9e',
  'ed25393b-7d61-4862-93e6-774caa285344',
  '222d13c8-7791-48e1-bfc8-a4db60afb045',
  'e8eb3695-3d5c-4efa-ab3e-f50955f51e65',
  'bb18d65e-40ac-4ad1-927c-16b10e7bb8d0',
  '731781b1-d8c2-4dd4-b648-8e7acdc63261',
  '8fd70d35-3058-40c6-a67b-0eada104cbbd',
  'c6c27ef3-ea84-4cad-80ac-b29b961d787b',
  'afce2b5d-7702-4272-9573-66d773253270',
  '3992dc7a-1722-455e-9544-f7403c23b6e6',
  '290c2aa7-b3bc-4cab-b716-93f8fc22ff26',
  '06edc1bf-c525-49fd-a0f3-f7e796ced083',
  '6a19a17e-bcae-4918-aa0a-8de06425ab0f',
  '76e42e55-9b93-4c9a-ba88-bde3b00ee1b9'
);

UPDATE food_items SET name_es = CASE id
  WHEN '1949a024-1591-4fb7-981b-0761854e365c' THEN 'Cơm Tấm (Arroz Partido con Cerdo a la Parrilla)'
  WHEN 'e19d5cdb-083f-4aba-988b-5ba3954700ce' THEN 'Core Power Elite Shake (Chocolate)'
  WHEN '45682039-3800-48a7-b4be-1fe8f8c3149c' THEN 'Corn Dog'
  WHEN '73d7d4b8-21be-43c7-b777-b3a8b2df50de' THEN 'Pan de Maíz'
  WHEN 'd5d25dfd-a19f-438a-9ca1-baf17a939572' THEN 'Cerveza Corona (12 oz)'
  WHEN 'c51565e1-9262-4fe8-b884-13193f9966d8' THEN 'Bistec Frito Empanizado'
  WHEN '02861b2d-c811-44be-a366-526a996792d9' THEN 'Coxinha'
  WHEN 'a0cf6d45-f253-450c-a708-38053496300c' THEN 'Crazy Bread'
  WHEN 'b0a7cc8b-7275-49c7-8b33-14ea9a6e2f82' THEN 'Crema de Arroz'
  WHEN 'd4d669eb-323f-494d-9934-ee27983cc54f' THEN 'Crepes Simples (2)'
  WHEN 'b3a27569-f10f-4590-ac38-d526d012d73c' THEN 'Papas Fritas Rizadas'
  WHEN 'ea9b008c-8639-44c0-9b28-c3a8a172f9ff' THEN 'Papas Fritas Rizadas'
  WHEN '8b27b365-f19d-4222-b794-5238ceb42446' THEN 'Dal Makhani'
  WHEN 'dfd878e1-ef7e-4957-8062-4a964ff8000c' THEN 'Porción de Pizza Deep Deep Dish de Pepperoni'
  WHEN '5af2f982-d9ff-412a-b8b6-27f7260aec0f' THEN 'Dilly Bar'
  WHEN 'e869d2b7-55f0-4ffa-85ab-e01917374543' THEN 'Doenjang Jjigae'
  WHEN 'bf39fa25-38ac-47a5-9b86-44ec42838901' THEN 'Döner Kebab'
  WHEN 'c45ba1fc-90db-426c-a639-01112198c21b' THEN 'Doro Wat'
  WHEN '54a931c8-a240-4db3-90c6-53776a2f2aff' THEN 'Double ButterBurger con Queso'
  WHEN 'b49bed53-a48e-4537-a437-2615d0d00c6e' THEN 'Doble Hamburguesa con Queso'
  WHEN '5185ee8a-88f1-4e4c-8860-657b50fe458b' THEN 'Doble Hamburguesa con Queso'
  WHEN '44dd85a0-02a2-4a82-bbce-e3d4f6f65d6f' THEN 'Double Meat Whataburger'
  WHEN '36bd0811-b12b-418c-b02c-a582caa6f763' THEN 'Fruta del Dragón'
  WHEN '3ce31e2f-f93f-4c00-986a-458505da14f5' THEN 'Pechuga de Pato (asada)'
  WHEN 'ed5ea861-c4b9-4d20-8b0c-e355b81dcb56' THEN 'Fideos de Huevo (cocidos)'
  WHEN '101fdb3d-6c2b-473a-8db4-d31bbc644b54' THEN 'Rollitos de Huevo (3 pc)'
  WHEN '13f547f5-5e9e-408a-8206-badd2f147f38' THEN 'Huevos Benedictinos'
  WHEN 'ac9585c8-1f1e-4f59-bd2c-f0a3b4772f3d' THEN 'Polvo de Electrolitos'
  WHEN 'bb400a72-ab0b-417c-9d66-5c367d85b484' THEN 'Elote (Maíz Callejero Mexicano)'
  WHEN '28be97a8-f2e4-4b53-8090-a1fb47ebb4c0' THEN 'Enchiladas Rojas (3)'
  WHEN 'ebe5123a-b6ac-4dc3-8226-c7129e66e081' THEN 'Plato Combinado Etíope'
  WHEN 'c20144ab-4615-4beb-a4db-9138e5260f03' THEN 'Tibs Etíopes'
  WHEN 'ecf315ce-aff7-4eb2-9699-88708310ef8f' THEN 'Farofa'
  WHEN '00c7a880-cb1b-4b1b-9cd9-d36f02aab325' THEN 'Feijoada'
  WHEN '27248985-e620-4005-8c62-b15cedf0e127' THEN 'Hinojo (crudo)'
  WHEN '4f8d40dc-e142-4f48-9cbc-df31e1f52d3f' THEN 'Queso Feta (desmenuzado)'
  WHEN '11638321-7a30-4ad6-95a7-f9371749dfe0' THEN 'Cápsula de Aceite de Pescado'
  WHEN '927c5f36-0b30-4cff-8904-290f3b8d2779' THEN 'Salsa de Pescado'
  WHEN '3f450f16-5a43-4cea-8358-88ed38d0d408' THEN 'Focaccia'
  WHEN 'c20127ab-57d2-4f1c-99fb-1d310c39e322' THEN 'Footlong Chili Cheese Coney Sonic'
  WHEN '03aba794-af5f-459f-b830-087bca639e2c' THEN 'Sándwich French Dip'
  WHEN 'a21e0617-b8fd-4f85-b4fc-44c667845cfa' THEN 'Sopa de Cebolla Francesa'
  WHEN '2bdb017c-ccff-407e-9b91-72c0a5836fec' THEN 'Jugo Fresco de Remolacha'
  WHEN '01ad5860-bd85-4e8b-ad6d-9e46b71af358' THEN 'Jugo Fresco de Apio'
  WHEN 'd475d96f-8c07-417c-b70b-f86e703615a6' THEN 'Ejotes Frescos Sazonados'
  WHEN '86b9e4cb-d1ae-4abd-ba4b-1e880c10b839' THEN 'Panecillos Recién Horneados (2)'
  WHEN '8bd3727d-c41c-4780-9760-2abd23f21135' THEN 'Natilla Helada (Vainilla)'
  WHEN '20e19a2a-2bde-4380-aa53-73b28c5627d9' THEN 'Funnel Cake'
  WHEN 'ef75f633-6386-4c6d-8f61-7949f5681e56' THEN 'Naan de Ajo'
  WHEN 'f629e6f3-acff-4e5c-947e-247167e5a904' THEN 'Alitas al Ajo Parmesano (6 pc)'
  WHEN '2421e263-17fe-4a56-9e6d-3528117e93a0' THEN 'Gelato (1 bola)'
  WHEN '6e225711-59be-4135-9532-64115ec774a6' THEN 'Ghost Protein Bar'
  WHEN 'e27614a5-5aed-463e-bc10-cee5633af48c' THEN 'Kombucha de Jengibre y Limón'
  WHEN 'eff1661d-7045-4094-9c8d-8f9864029263' THEN 'Carne de Cabra (guisada)'
  WHEN '2b5f0c3f-35c9-4b4f-a2b9-d9959c8973de' THEN 'Gochujang (Pasta de Chile Coreana)'
  WHEN 'a44047cf-438e-4fba-a520-1d6bca1208c2' THEN 'Latte Dorado de Cúrcuma'
  WHEN 'ad531a0b-e1f2-4dc8-87ee-0eeb975bc15e' THEN 'Queso Gouda'
  WHEN '19ad544a-1ca0-48c2-99e3-a7069b2fc744' THEN 'Hamburguesa Gourmet con Queso'
  WHEN '9eef37bf-61b7-405f-b45d-781a5ec13fb3' THEN 'Grand Slam'
  WHEN '372e958f-a848-4eb4-b7a4-37c886f00761' THEN 'Granola (natural)'
  WHEN '73d7c9b5-656e-4fb0-b159-85f34144e1c1' THEN 'Bowl de Granola con Leche'
  WHEN '8fc980a8-7eea-4e74-a47d-ff99fe472de3' THEN 'Cereal Grape Nuts'
  WHEN 'b9e07fa6-ed14-4a1b-b289-462c7ffc2ab8' THEN 'Ensalada Griega'
  WHEN '3b2589c3-5cc5-462d-af8e-a853d6e2b398' THEN 'Grenade Carb Killa Bar'
  WHEN '65f1c4d3-9a47-4750-8528-53a69f6f35d2' THEN 'Sándwich de Queso a la Parrilla'
  WHEN '40c5b79b-59c1-4947-8bab-65771f27866d' THEN 'Salmón a la Parrilla'
  WHEN '07d457ea-963c-4e70-956f-ad8ffa0fdcf2' THEN 'Salmón a la Parrilla'
  WHEN 'bece9497-113e-4064-bf83-11021bee247d' THEN 'Wrap de Verduras a la Parrilla'
  WHEN '716cf666-c876-4c77-8dca-aedc07b99fad' THEN 'Grits (cocidos)'
  WHEN 'dd1f4a38-eb6f-4fad-b7cc-012d99b33b2e' THEN 'Guayaba (fresca)'
  WHEN 'df8c3ea1-0533-45af-b068-4164fedbf248' THEN 'Ositos de Goma'
  WHEN '4c4731b1-3e29-4516-9241-e429fe47baaf' THEN 'Half & Half'
  WHEN '09285e30-e592-4cee-9695-0619091e8b61' THEN 'Hallacas'
  WHEN '85c574fa-c5b8-4140-9715-77423671d4c2' THEN 'Halo-Halo'
  WHEN '8f366dd5-b997-493d-b452-479826822618' THEN 'Haribo Gold-Bears'
  WHEN '5679b466-4a74-48a6-8516-39d61406ff74' THEN 'Pancakes de Grano y Nuez Harvest (3)'
  WHEN 'c37ab70e-5585-47a6-af22-613514119086' THEN 'Crema para Batir Espesa'
  WHEN 'd7cc6062-e8cc-4445-830a-d83436572e40' THEN 'Cerveza Heineken (12 oz)'
  WHEN '2075a2eb-3a53-4613-a88a-d59f78c2a88c' THEN 'Hi-Chew Fresa'
  WHEN '7ee363b5-2144-43f8-b885-b967bb00945b' THEN 'Salsa Hoisin'
  WHEN '2086fa90-84cd-4930-8bf8-1e963c664f78' THEN 'Porción de Pizza de Queso Hot-N-Ready'
  WHEN '5529827c-3ec8-4f2d-942b-c12ab95ad74e' THEN 'Porción de Pizza de Pepperoni Hot-N-Ready'
  WHEN '5ef9a943-31f2-470c-b900-6f0289d1171c' THEN 'House Zalad con Pollo a la Parrilla Zaxby''s'
  WHEN '384a77e8-dbd0-45fa-b649-9b1af7bd9dba' THEN 'Injera'
  WHEN '6050b114-a164-412c-b1ad-9334fad9b0a5' THEN 'Jaca (fresca)'
  WHEN '305f7c49-c157-4cac-bdbf-970002941a8c' THEN 'Japchae'
  WHEN '8c64adf1-efa6-4489-96b6-0cc535aecbe2' THEN 'Jícama (cruda)'
  WHEN '5a0680e1-f1a0-4900-98b0-71dbb285d642' THEN 'Jumbo Jack'
  WHEN '4501988d-1afb-4b9d-8625-d099c36d970a' THEN 'Kare-Kare'
  WHEN 'a04821fa-243c-4026-aa68-3e8e00f003b7' THEN 'Cereal Kashi GO'
  ELSE name_es
END
WHERE id IN (
  '1949a024-1591-4fb7-981b-0761854e365c',
  'e19d5cdb-083f-4aba-988b-5ba3954700ce',
  '45682039-3800-48a7-b4be-1fe8f8c3149c',
  '73d7d4b8-21be-43c7-b777-b3a8b2df50de',
  'd5d25dfd-a19f-438a-9ca1-baf17a939572',
  'c51565e1-9262-4fe8-b884-13193f9966d8',
  '02861b2d-c811-44be-a366-526a996792d9',
  'a0cf6d45-f253-450c-a708-38053496300c',
  'b0a7cc8b-7275-49c7-8b33-14ea9a6e2f82',
  'd4d669eb-323f-494d-9934-ee27983cc54f',
  'b3a27569-f10f-4590-ac38-d526d012d73c',
  'ea9b008c-8639-44c0-9b28-c3a8a172f9ff',
  '8b27b365-f19d-4222-b794-5238ceb42446',
  'dfd878e1-ef7e-4957-8062-4a964ff8000c',
  '5af2f982-d9ff-412a-b8b6-27f7260aec0f',
  'e869d2b7-55f0-4ffa-85ab-e01917374543',
  'bf39fa25-38ac-47a5-9b86-44ec42838901',
  'c45ba1fc-90db-426c-a639-01112198c21b',
  '54a931c8-a240-4db3-90c6-53776a2f2aff',
  'b49bed53-a48e-4537-a437-2615d0d00c6e',
  '5185ee8a-88f1-4e4c-8860-657b50fe458b',
  '44dd85a0-02a2-4a82-bbce-e3d4f6f65d6f',
  '36bd0811-b12b-418c-b02c-a582caa6f763',
  '3ce31e2f-f93f-4c00-986a-458505da14f5',
  'ed5ea861-c4b9-4d20-8b0c-e355b81dcb56',
  '101fdb3d-6c2b-473a-8db4-d31bbc644b54',
  '13f547f5-5e9e-408a-8206-badd2f147f38',
  'ac9585c8-1f1e-4f59-bd2c-f0a3b4772f3d',
  'bb400a72-ab0b-417c-9d66-5c367d85b484',
  '28be97a8-f2e4-4b53-8090-a1fb47ebb4c0',
  'ebe5123a-b6ac-4dc3-8226-c7129e66e081',
  'c20144ab-4615-4beb-a4db-9138e5260f03',
  'ecf315ce-aff7-4eb2-9699-88708310ef8f',
  '00c7a880-cb1b-4b1b-9cd9-d36f02aab325',
  '27248985-e620-4005-8c62-b15cedf0e127',
  '4f8d40dc-e142-4f48-9cbc-df31e1f52d3f',
  '11638321-7a30-4ad6-95a7-f9371749dfe0',
  '927c5f36-0b30-4cff-8904-290f3b8d2779',
  '3f450f16-5a43-4cea-8358-88ed38d0d408',
  'c20127ab-57d2-4f1c-99fb-1d310c39e322',
  '03aba794-af5f-459f-b830-087bca639e2c',
  'a21e0617-b8fd-4f85-b4fc-44c667845cfa',
  '2bdb017c-ccff-407e-9b91-72c0a5836fec',
  '01ad5860-bd85-4e8b-ad6d-9e46b71af358',
  'd475d96f-8c07-417c-b70b-f86e703615a6',
  '86b9e4cb-d1ae-4abd-ba4b-1e880c10b839',
  '8bd3727d-c41c-4780-9760-2abd23f21135',
  '20e19a2a-2bde-4380-aa53-73b28c5627d9',
  'ef75f633-6386-4c6d-8f61-7949f5681e56',
  'f629e6f3-acff-4e5c-947e-247167e5a904',
  '2421e263-17fe-4a56-9e6d-3528117e93a0',
  '6e225711-59be-4135-9532-64115ec774a6',
  'e27614a5-5aed-463e-bc10-cee5633af48c',
  'eff1661d-7045-4094-9c8d-8f9864029263',
  '2b5f0c3f-35c9-4b4f-a2b9-d9959c8973de',
  'a44047cf-438e-4fba-a520-1d6bca1208c2',
  'ad531a0b-e1f2-4dc8-87ee-0eeb975bc15e',
  '19ad544a-1ca0-48c2-99e3-a7069b2fc744',
  '9eef37bf-61b7-405f-b45d-781a5ec13fb3',
  '372e958f-a848-4eb4-b7a4-37c886f00761',
  '73d7c9b5-656e-4fb0-b159-85f34144e1c1',
  '8fc980a8-7eea-4e74-a47d-ff99fe472de3',
  'b9e07fa6-ed14-4a1b-b289-462c7ffc2ab8',
  '3b2589c3-5cc5-462d-af8e-a853d6e2b398',
  '65f1c4d3-9a47-4750-8528-53a69f6f35d2',
  '40c5b79b-59c1-4947-8bab-65771f27866d',
  '07d457ea-963c-4e70-956f-ad8ffa0fdcf2',
  'bece9497-113e-4064-bf83-11021bee247d',
  '716cf666-c876-4c77-8dca-aedc07b99fad',
  'dd1f4a38-eb6f-4fad-b7cc-012d99b33b2e',
  'df8c3ea1-0533-45af-b068-4164fedbf248',
  '4c4731b1-3e29-4516-9241-e429fe47baaf',
  '09285e30-e592-4cee-9695-0619091e8b61',
  '85c574fa-c5b8-4140-9715-77423671d4c2',
  '8f366dd5-b997-493d-b452-479826822618',
  '5679b466-4a74-48a6-8516-39d61406ff74',
  'c37ab70e-5585-47a6-af22-613514119086',
  'd7cc6062-e8cc-4445-830a-d83436572e40',
  '2075a2eb-3a53-4613-a88a-d59f78c2a88c',
  '7ee363b5-2144-43f8-b885-b967bb00945b',
  '2086fa90-84cd-4930-8bf8-1e963c664f78',
  '5529827c-3ec8-4f2d-942b-c12ab95ad74e',
  '5ef9a943-31f2-470c-b900-6f0289d1171c',
  '384a77e8-dbd0-45fa-b649-9b1af7bd9dba',
  '6050b114-a164-412c-b1ad-9334fad9b0a5',
  '305f7c49-c157-4cac-bdbf-970002941a8c',
  '8c64adf1-efa6-4489-96b6-0cc535aecbe2',
  '5a0680e1-f1a0-4900-98b0-71dbb285d642',
  '4501988d-1afb-4b9d-8625-d099c36d970a',
  'a04821fa-243c-4026-aa68-3e8e00f003b7'
);

UPDATE food_items SET name_es = CASE id
  WHEN '762f7fef-6e35-4270-8c99-7e4e43238c92' THEN 'Kéfir (natural)'
  WHEN 'd8bae76c-065f-4423-a5de-16d0d536dd11' THEN 'KFC Biscuit'
  WHEN '2023fe00-cdde-4b1b-a650-2116d0f70a48' THEN 'KFC Pastel de Pollo'
  WHEN '5f0e4651-4681-40fd-9774-5fba2e6c0fb7' THEN 'KFC Ensalada de Col'
  WHEN 'f64088f0-c305-4875-8b5d-7f29754bff66' THEN 'KFC Pechuga de Pollo Extra Crujiente'
  WHEN '892c6764-2b1c-412c-af37-8f5cc2e0096b' THEN 'KFC Famous Bowl'
  WHEN 'cbba91bf-1f68-4119-9d25-71fde24a0421' THEN 'KFC Mac & Cheese'
  WHEN '172b02e3-2bba-4d3f-8c1f-c8c9383657e5' THEN 'KFC Puré de Patatas con Salsa'
  WHEN '594cb4f4-4810-4436-85eb-5f03e86a9e94' THEN 'KFC Pechuga de Pollo Receta Original'
  WHEN '65cee290-37c3-4733-b843-273208819d23' THEN 'KFC Popcorn Nuggets'
  WHEN '1006ad9d-3549-468e-99f2-52b0ff86de7c' THEN 'KFC Sándwich de Pollo Picante'
  WHEN '5ab55842-716f-4982-bcae-6c883717f90d' THEN 'Khao Man Gai'
  WHEN '6c20eb5f-0ed6-4bf4-854b-e3ca0eeac238' THEN 'Kimchi'
  WHEN '409c4fcc-2167-495a-bd83-4c0610d687e6' THEN 'Bulgogi Coreano de Res'
  WHEN '704b4403-3098-4db8-b19c-da45423cc003' THEN 'Fideos Fríos Coreanos Bibim'
  WHEN '1331d78f-ce35-4a16-ba84-4b0aa5bd3a6f' THEN 'Pollo Frito Coreano (4 pc)'
  WHEN 'f47e6fec-c282-4224-8463-4b12eea3d160' THEN 'Galbi Coreano (Costillas Cortas)'
  WHEN '7d3c7dfa-c2c8-4ccd-afba-c9da178b2c56' THEN 'Samgyeopsal Coreano (Panceta de Cerdo)'
  WHEN 'b1389d61-1298-47cf-a9df-10a839e6de55' THEN 'Kumquat'
  WHEN 'b99752c9-88f4-4965-b643-8871dc4d9ae4' THEN 'L-Glutamina en Polvo'
  WHEN '010d9185-a094-480c-8112-0cb3935d6a3d' THEN 'Lahmacun'
  WHEN 'e8921c9f-5054-40f8-9008-949cfe67a451' THEN 'Pretzel Suave Grande'
  WHEN 'c86e18b6-761e-4313-bc14-2b25b6e9981e' THEN 'Lay''s Chips Clásicas'
  WHEN 'c7bb6b68-8704-44f9-be27-0472b050d1d4' THEN 'Lechon Kawali (Panceta de Cerdo Crujiente)'
  WHEN '248c4e53-c0d2-4488-bbe9-7b81fe20861b' THEN 'Puerro (cocido)'
  WHEN '4e006496-d565-4108-a97a-35ec5f9af825' THEN 'Alitas de Limón y Pimienta (6 pc)'
  WHEN '20f965c5-9558-4e26-a916-fa52084e50dc' THEN 'Sopa de Lentejas'
  WHEN 'eca1eb48-08ad-4165-bcc9-2b13f13e97bc' THEN 'Papas Rizadas Cargadas'
  WHEN '7895de26-01ad-4d7d-af35-03fcf72d09bb' THEN 'Batata Cargada'
  WHEN '53235c00-3e71-456f-85c3-371411a48faf' THEN 'Cola de Langosta (8 oz)'
  WHEN '2fe3630e-744d-48f4-b16f-1ca7f8090875' THEN 'Lomo Saltado'
  WHEN 'c0c6e063-643c-4809-b557-8006bbbd4164' THEN 'Longán (fresco)'
  WHEN '6d1cf73b-5ff7-47b8-9040-c9eef8a0188d' THEN 'Lumpia Shanghai (6 pc)'
  WHEN '2d7f962a-ba69-4677-8dbc-0e9a276f0ed2' THEN 'Lichi (fresco)'
  WHEN 'de6a8c25-b00d-471c-9528-5ecf657e18a1' THEN 'Glicinato de Magnesio'
  WHEN '42bff590-1967-4dff-b370-130332f4387f' THEN 'Alitas de Mango Habanero (6 pc)'
  WHEN '12c59cdc-151f-4c88-9448-16f4971655e7' THEN 'Arroz Pegajoso con Mango'
  WHEN '9db9b0d4-a1e4-4cdf-b02d-fff72b7a823b' THEN 'Queso Mascarpone'
  WHEN '3a9176cf-fe7e-4979-9975-51deb280520b' THEN 'Curry Massaman'
  WHEN 'e8b89a85-2873-4ced-8c0c-b54b187114f1' THEN 'Menemen (Plato Turco de Huevo)'
  WHEN 'f33d73ce-eb06-47ef-97ff-7fc89f0e051d' THEN 'Menudo'
  WHEN '242ff4ed-76b1-40fb-8999-76cdf024309f' THEN 'Mijo (cocido)'
  WHEN '729e6e17-6bc2-4743-b4e6-f7c557783a36' THEN 'Sopa Minestrone'
  WHEN '37793cd2-b9b6-4250-85aa-11947bdcde0a' THEN 'Misir (Estofado de Lentejas Rojas)'
  WHEN '90f54c9c-e408-4b3a-a2b9-6acf105b5d82' THEN 'Pasta de Miso (blanca)'
  WHEN 'da2f213e-c139-4c00-a6e7-ad999004b535' THEN 'Mochi Helado (3 pc)'
  WHEN 'bcf95711-375a-4f4d-83bc-0c0c8a04a36b' THEN 'Moons Over My Hammy'
  WHEN '4f00428a-278e-4a7d-8029-6bcf02b98b36' THEN 'Moussaka'
  WHEN '37d44aad-60d3-4dcc-9978-e49562385a52' THEN 'Nature Valley Barra Crujiente'
  WHEN 'd9c4ecde-2f98-4645-9138-bb666f802809' THEN 'Sopa de Almejas de Nueva Inglaterra'
  WHEN '4f965cca-0d26-42df-8344-71730eb0833d' THEN 'Sopa de Almejas de Nueva Inglaterra'
  WHEN '5281515a-abeb-4e84-84a1-9d65926ba385' THEN 'Pancakes de Cheesecake de Nueva York'
  WHEN '6c70e052-13d2-49fa-82f6-da39147a285d' THEN 'Nopales a la Parrilla'
  WHEN '2cc82708-a398-4399-b9b1-789fe60227ae' THEN 'Sándwich de Bacalao del Atlántico Norte'
  WHEN '744f4586-a0b8-4fef-94f0-8a6df2cc8e83' THEN 'Nutri-Grain Barra de Fresa'
  WHEN '7fb83cef-d067-4dda-b6da-d8a8483e1eec' THEN 'Omega-3 Aceite de Pescado (1000mg)'
  WHEN '15a4e6a5-a203-4a1f-b5e8-1a3acc2967c8' THEN 'Aros de Cebolla (Medium)'
  WHEN 'cc430b7c-e668-4219-82e5-d81e21bca6c3' THEN 'Oreo Blizzard (Medium)'
  WHEN 'ac321ba1-bfe1-4d1e-be8c-c3b9f3cf8722' THEN 'Orgain Batido de Proteína Vegetal'
  WHEN '6d762b72-9c8a-4f0d-9321-ad765d4e253a' THEN 'Pancakes Originales de Suero de Leche (3)'
  WHEN '6a422c66-3d33-4c84-87b4-7b8f7c7fb15b' THEN 'Sub Italiano Original (Regular)'
  WHEN '0dcadb0b-8116-463f-9ceb-5056bc260f13' THEN 'Oyakodon'
  WHEN 'd8914e6b-444e-4408-a656-9bba7ada3e9b' THEN 'Salsa de Ostras'
  WHEN '72311ca9-27ad-4f56-905b-e867d388a240' THEN 'Pabellón Criollo'
  WHEN '93988602-3ed9-4b38-8081-29af7a80b895' THEN 'Palak Paneer'
  WHEN '2dcb927b-d512-4aec-b632-2ca2c1ba4cf0' THEN 'Vieiras Selladas en Sartén'
  WHEN 'f3717dff-9369-4939-871a-5e85b5461b56' THEN 'Pancakes (4)'
  WHEN 'd076aca1-e7a2-4418-8538-d816efed25d1' THEN 'Pancit Bihon'
  WHEN 'c80a070b-2572-4055-846c-1d62089847b7' THEN 'Pão de Queijo (3 pc)'
  WHEN 'b3e69f74-2413-44a4-ab46-f9a6c1930ab4' THEN 'Papaya (fresca)'
  WHEN '32f75607-e3ef-4e93-ac0e-64901d926a55' THEN 'Chirivía (asada)'
  WHEN 'c525dacb-4971-47ea-acb1-183bba072af6' THEN 'Maracuyá'
  WHEN '7661250d-16da-487d-a713-318773cc0682' THEN 'Peanut Butter Cookie Dough Blizzard (Medium)'
  WHEN '4a8fd63a-5d93-428e-97b3-557c9a3f31b6' THEN 'Caqui (fresco)'
  WHEN '012b1529-a2f4-4a54-bdd1-99e83ab18aba' THEN 'Sándwich Philly Cheesesteak'
  WHEN 'bc96cb83-feb4-4f15-a504-fe7dd2ba75a9' THEN 'Sub Philly Cheesesteak (Regular)'
  WHEN 'de6df890-4947-4fef-a9a3-b4bb6a764117' THEN 'Pirate''s Booty White Cheddar'
  WHEN 'b8cf01d6-89ba-4fb4-a000-81da0f571f3c' THEN 'Polenta (cocida)'
  WHEN '319a78bd-efa6-4ac4-bb27-9771abb3157c' THEN 'PopCorners White Cheddar'
  WHEN 'e5e98084-7bb2-4702-8ab2-0148ce084976' THEN 'Sinigang de Cerdo'
  WHEN '3b6a81d0-6e0c-4f50-8f09-ed2a7e76763a' THEN 'Pozole Rojo'
  WHEN 'e637eff8-f321-4dcd-be42-1f12432407bc' THEN 'Polvo Pre-Entreno'
  WHEN '2be0ad6c-a384-46e6-9f6b-d0d0126c21c7' THEN 'Prime Bebida de Hidratación'
  WHEN 'bb6b16a2-d290-42c5-a9a3-72f1d566b663' THEN 'Pringles Original'
  WHEN '91547730-c83e-42ca-982c-9052b35898a3' THEN 'Chips de Proteína (Ranch)'
  WHEN '3d454970-c4ec-4cd8-989f-2951e76e7a35' THEN 'Quiche Lorraine (1 slice)'
  WHEN 'dc2ec6ea-b6bb-4be3-9e64-806b6475e078' THEN 'Conejo (asado)'
  WHEN '80b5af86-d3d2-4397-83f6-187e817caad7' THEN 'Trucha Arcoíris (horneada)'
  WHEN 'ee369143-8752-4380-b795-9951f186fe33' THEN 'Ostras Crudas (6)'
  WHEN '18a94d0c-6777-4d10-8517-353d011d7f1f' THEN 'Pasta de Curry Rojo'
  ELSE name_es
END
WHERE id IN (
  '762f7fef-6e35-4270-8c99-7e4e43238c92',
  'd8bae76c-065f-4423-a5de-16d0d536dd11',
  '2023fe00-cdde-4b1b-a650-2116d0f70a48',
  '5f0e4651-4681-40fd-9774-5fba2e6c0fb7',
  'f64088f0-c305-4875-8b5d-7f29754bff66',
  '892c6764-2b1c-412c-af37-8f5cc2e0096b',
  'cbba91bf-1f68-4119-9d25-71fde24a0421',
  '172b02e3-2bba-4d3f-8c1f-c8c9383657e5',
  '594cb4f4-4810-4436-85eb-5f03e86a9e94',
  '65cee290-37c3-4733-b843-273208819d23',
  '1006ad9d-3549-468e-99f2-52b0ff86de7c',
  '5ab55842-716f-4982-bcae-6c883717f90d',
  '6c20eb5f-0ed6-4bf4-854b-e3ca0eeac238',
  '409c4fcc-2167-495a-bd83-4c0610d687e6',
  '704b4403-3098-4db8-b19c-da45423cc003',
  '1331d78f-ce35-4a16-ba84-4b0aa5bd3a6f',
  'f47e6fec-c282-4224-8463-4b12eea3d160',
  '7d3c7dfa-c2c8-4ccd-afba-c9da178b2c56',
  'b1389d61-1298-47cf-a9df-10a839e6de55',
  'b99752c9-88f4-4965-b643-8871dc4d9ae4',
  '010d9185-a094-480c-8112-0cb3935d6a3d',
  'e8921c9f-5054-40f8-9008-949cfe67a451',
  'c86e18b6-761e-4313-bc14-2b25b6e9981e',
  'c7bb6b68-8704-44f9-be27-0472b050d1d4',
  '248c4e53-c0d2-4488-bbe9-7b81fe20861b',
  '4e006496-d565-4108-a97a-35ec5f9af825',
  '20f965c5-9558-4e26-a916-fa52084e50dc',
  'eca1eb48-08ad-4165-bcc9-2b13f13e97bc',
  '7895de26-01ad-4d7d-af35-03fcf72d09bb',
  '53235c00-3e71-456f-85c3-371411a48faf',
  '2fe3630e-744d-48f4-b16f-1ca7f8090875',
  'c0c6e063-643c-4809-b557-8006bbbd4164',
  '6d1cf73b-5ff7-47b8-9040-c9eef8a0188d',
  '2d7f962a-ba69-4677-8dbc-0e9a276f0ed2',
  'de6a8c25-b00d-471c-9528-5ecf657e18a1',
  '42bff590-1967-4dff-b370-130332f4387f',
  '12c59cdc-151f-4c88-9448-16f4971655e7',
  '9db9b0d4-a1e4-4cdf-b02d-fff72b7a823b',
  '3a9176cf-fe7e-4979-9975-51deb280520b',
  'e8b89a85-2873-4ced-8c0c-b54b187114f1',
  'f33d73ce-eb06-47ef-97ff-7fc89f0e051d',
  '242ff4ed-76b1-40fb-8999-76cdf024309f',
  '729e6e17-6bc2-4743-b4e6-f7c557783a36',
  '37793cd2-b9b6-4250-85aa-11947bdcde0a',
  '90f54c9c-e408-4b3a-a2b9-6acf105b5d82',
  'da2f213e-c139-4c00-a6e7-ad999004b535',
  'bcf95711-375a-4f4d-83bc-0c0c8a04a36b',
  '4f00428a-278e-4a7d-8029-6bcf02b98b36',
  '37d44aad-60d3-4dcc-9978-e49562385a52',
  'd9c4ecde-2f98-4645-9138-bb666f802809',
  '4f965cca-0d26-42df-8344-71730eb0833d',
  '5281515a-abeb-4e84-84a1-9d65926ba385',
  '6c70e052-13d2-49fa-82f6-da39147a285d',
  '2cc82708-a398-4399-b9b1-789fe60227ae',
  '744f4586-a0b8-4fef-94f0-8a6df2cc8e83',
  '7fb83cef-d067-4dda-b6da-d8a8483e1eec',
  '15a4e6a5-a203-4a1f-b5e8-1a3acc2967c8',
  'cc430b7c-e668-4219-82e5-d81e21bca6c3',
  'ac321ba1-bfe1-4d1e-be8c-c3b9f3cf8722',
  '6d762b72-9c8a-4f0d-9321-ad765d4e253a',
  '6a422c66-3d33-4c84-87b4-7b8f7c7fb15b',
  '0dcadb0b-8116-463f-9ceb-5056bc260f13',
  'd8914e6b-444e-4408-a656-9bba7ada3e9b',
  '72311ca9-27ad-4f56-905b-e867d388a240',
  '93988602-3ed9-4b38-8081-29af7a80b895',
  '2dcb927b-d512-4aec-b632-2ca2c1ba4cf0',
  'f3717dff-9369-4939-871a-5e85b5461b56',
  'd076aca1-e7a2-4418-8538-d816efed25d1',
  'c80a070b-2572-4055-846c-1d62089847b7',
  'b3e69f74-2413-44a4-ab46-f9a6c1930ab4',
  '32f75607-e3ef-4e93-ac0e-64901d926a55',
  'c525dacb-4971-47ea-acb1-183bba072af6',
  '7661250d-16da-487d-a713-318773cc0682',
  '4a8fd63a-5d93-428e-97b3-557c9a3f31b6',
  '012b1529-a2f4-4a54-bdd1-99e83ab18aba',
  'bc96cb83-feb4-4f15-a504-fe7dd2ba75a9',
  'de6df890-4947-4fef-a9a3-b4bb6a764117',
  'b8cf01d6-89ba-4fb4-a000-81da0f571f3c',
  '319a78bd-efa6-4ac4-bb27-9771abb3157c',
  'e5e98084-7bb2-4702-8ab2-0148ce084976',
  '3b6a81d0-6e0c-4f50-8f09-ed2a7e76763a',
  'e637eff8-f321-4dcd-be42-1f12432407bc',
  '2be0ad6c-a384-46e6-9f6b-d0d0126c21c7',
  'bb6b16a2-d290-42c5-a9a3-72f1d566b663',
  '91547730-c83e-42ca-982c-9052b35898a3',
  '3d454970-c4ec-4cd8-989f-2951e76e7a35',
  'dc2ec6ea-b6bb-4be3-9e64-806b6475e078',
  '80b5af86-d3d2-4397-83f6-187e817caad7',
  'ee369143-8752-4380-b795-9951f186fe33',
  '18a94d0c-6777-4d10-8517-353d011d7f1f'
);

UPDATE food_items SET name_es = CASE id
  WHEN '0c5ef4de-5370-459d-b279-7d24edf22810' THEN 'Vino Tinto (copa de 5 oz)'
  WHEN 'e1880e63-ec14-4351-8d08-784772f899b8' THEN 'Fideos de Arroz (cocidos)'
  WHEN '68fde5d4-728e-4284-853a-6a37c3f453c2' THEN 'Queso Ricotta'
  WHEN 'cb9b939b-7f01-4988-809e-3094d8a9b020' THEN 'Ritz Crackers (5)'
  WHEN 'dad41437-e6ff-4e8d-b798-30047e9cb8df' THEN 'Ron con Coca-Cola'
  WHEN 'a193cfc4-9a25-4af1-acd3-2af61f843f6a' THEN 'Samosa Chaat'
  WHEN '45a3749a-5fdc-4513-aa05-3efc224fe005' THEN 'Sancocho Colombiano'
  WHEN '03e78a53-e03d-4a66-b1f9-08586ba806bb' THEN 'Scrambler'
  WHEN '3b37a067-1b94-40f2-bf0d-528bd345ec3f' THEN 'Papas Fritas Sazonadas'
  WHEN 'fe9f1d46-10e6-498a-9b39-fecac186bebf' THEN 'Papas Fritas Sazonadas (Medium)'
  WHEN 'd0fca7d0-2059-40e9-848e-8d0aca91b302' THEN 'Shack Stack'
  WHEN 'ecf57aac-4688-47ed-b2c3-73d829e9ae35' THEN 'ShackBurger'
  WHEN 'c6503907-1fbf-4133-bdc7-53c27a9459b3' THEN 'Shakshuka'
  WHEN '55c18409-255e-44d7-936b-3cc42407620e' THEN 'Camarones Scampi'
  WHEN 'a338d77f-ef9e-4ef1-be20-81c8f0036f45' THEN 'Sándwich Signature'
  WHEN 'd6491f7a-e3da-4e30-b000-27ffbff79199' THEN 'Sinangag (Arroz con Ajo Filipino)'
  WHEN 'f73e68be-832e-4254-91ee-9b73425596d9' THEN 'Slim 5 Ensalada de Atún'
  WHEN 'c3d5d1bc-9af9-4a17-bd1b-7ede0422dcab' THEN 'SmokeShack'
  WHEN 'a525042b-692d-4bd1-b8c4-3e1c74005330' THEN 'Fideos Soba (cocidos)'
  WHEN 'fa6371cc-bc2c-4a5c-8bac-5bc7d6e69d5a' THEN 'Sobrebarriga'
  WHEN 'f6459081-e931-4ab0-8a00-5ee5ddc4d6b5' THEN 'Cono de Helado Suave (Medium)'
  WHEN 'ca43926b-0955-42fe-93ba-b5a56b981fe0' THEN 'Som Tam (Ensalada de Papaya Verde)'
  WHEN 'eaa17cbd-b343-4133-acea-3da245a7a2fa' THEN 'Sonic Cheeseburger'
  WHEN 'ef57590d-ae7e-4724-866d-0c268d093f55' THEN 'Crema Agria (entera)'
  WHEN 'c1261a1c-c93a-46ef-b1de-fe97b86eda40' THEN 'Sour Patch Kids'
  WHEN 'b2324666-5052-481a-98ba-63aa1cfdebc6' THEN 'Pan de Masa Madre'
  WHEN 'fde6d0d6-8449-403b-9cf6-feecaf669a19' THEN 'Sourdough Jack'
  WHEN '4783d2c5-2b33-4c87-992a-b5c40f8bf664' THEN 'Spanakopita'
  WHEN 'ee9c7f57-fc52-4168-b436-3ce28cc2c8f3' THEN 'Sándwich de Pollo Picante'
  WHEN '2c453ede-4a15-4931-bc0d-3d95a12dd410' THEN 'Sándwich de Pollo Crujiente Picante'
  WHEN '883cec21-73d5-49a0-97ac-c9d0f8af9ee9' THEN 'Sprite (lata de 12 oz)'
  WHEN '01ca32e5-d17c-4980-905f-8986231fcb6c' THEN 'Carambola'
  WHEN '910520ae-f245-4873-bb79-d6db3f9773de' THEN 'Starburst Original'
  WHEN 'd7fbda32-6fe3-49bd-a06e-11be738b3376' THEN 'Papas Fritas Gruesas'
  WHEN 'f2bb1ec4-9c86-4599-a15f-f52b8a654d2e' THEN 'Almejas al Vapor'
  WHEN 'f9c7c942-d8e0-4a1f-aa40-90b735e1a3c3' THEN 'Mejillones al Vapor'
  WHEN '61a82e2f-f7ec-4494-bbce-a964294c397e' THEN 'Cheesecake de Fresa (1 rebanada)'
  WHEN 'bc790c3a-4fed-4518-a277-7790e6e1bb64' THEN 'Tostada Francesa Rellena'
  WHEN '538a3cbf-6c3b-4a51-9bf7-ec95d69b04e6' THEN 'Sundubu Jjigae (Guiso de Tofu Suave)'
  WHEN 'b3288a96-dfd8-48f2-8de5-a62e51f0cc1f' THEN 'Swedish Fish'
  WHEN 'ae6f4949-7366-41ac-a508-bb88ca197dd4' THEN 'Té Helado Dulce (16 oz)'
  WHEN 'fe1b498d-cbbe-4c01-b4a6-d8842885c473' THEN 'Acelga (cocida)'
  WHEN 'b91d39db-8d07-4a89-bf8c-814de1bc42c4' THEN 'Filete de Pez Espada (a la parrilla)'
  WHEN '2c161d14-8012-43c5-8175-2ca89c4379a0' THEN 'Tacos (2 pc)'
  WHEN '932feffe-5d04-471e-b48f-161acd802fa8' THEN 'Takis Fuego'
  WHEN '402c24f0-9b47-43c4-b77a-6c47cf113902' THEN 'Takoyaki (6 pc)'
  WHEN '9dfe8083-3c25-4de3-bc15-de2e746cc222' THEN 'Tamal (Cerdo, Chile Rojo)'
  WHEN '75bebdcc-ba31-4a7d-b4f7-df46581e4351' THEN 'Tamarindo'
  WHEN 'afcb3153-938e-4bb4-9417-b80412f45f7d' THEN 'Tater Tots (Medium)'
  WHEN '1c805936-0b5b-4eb5-a636-d131f0a0c78b' THEN 'Tequeños (4 pc)'
  WHEN 'c3ddda7c-3bd9-4ef8-9e92-690684e78266' THEN 'Shot de Tequila (1.5 oz)'
  WHEN '7b419f35-fab3-4e10-a241-c5d6a28b929d' THEN 'Texas Toast'
  WHEN 'a8c58f26-312a-4fb8-9551-c6710ffe3f3c' THEN 'The Pepe'
  WHEN '069421e6-7540-4f73-8ee6-454ea7ddbedb' THEN 'The Vito'
  WHEN 'ec669e08-2478-4f10-8e73-337e93e7ac48' THEN 'Tiramisú'
  WHEN 'c0743069-0fc0-40e8-bc67-d38210616c9d' THEN 'Tiramisú (1 rebanada)'
  WHEN 'f7b68b03-2fd5-46e9-a449-ddf5b7efa0df' THEN 'Tom Kha Gai'
  WHEN '7a9f6449-212f-4040-a9db-cea78e70feba' THEN 'Bisque de Tomate'
  WHEN 'fcf2d629-a3e6-4093-b826-21e20f62ac87' THEN 'Tonkatsu (Chuleta de Cerdo Empanizada)'
  WHEN '479b6083-3848-405d-9871-deec4a9cc691' THEN 'Tteokbokki'
  WHEN 'b64de5a8-e005-4a5c-8ce8-4e501befa3d6' THEN 'Sub de Pavo y Provolone (Regular)'
  WHEN '70434568-563c-4c7b-9256-9113c67da7b4' THEN 'Sándwich de Pavo en Pan de Masa Madre'
  WHEN '20cf5171-4064-43e8-9bd1-48f9bf3d9b89' THEN 'Turkey Tom'
  WHEN 'adc6cfce-99c6-4815-8d9d-f09155d825ca' THEN 'Nabo (cocido)'
  WHEN 'ff9338c8-20c2-423f-92d7-46641185a865' THEN 'Fideos Udon (cocidos)'
  WHEN 'c58aa5dd-ca9c-42d0-8322-99c312d5db24' THEN 'Ultimate Cheeseburger'
  WHEN '544360ea-920b-4f8e-9c01-53fd90ce77af' THEN 'Té Helado sin Azúcar (16 oz)'
  WHEN '01058f4d-d849-4bf7-9f39-df9368d55de3' THEN 'Natilla Fresca Congelada de Vainilla'
  WHEN 'a755082f-6992-428d-854a-cbbb6f7f578a' THEN 'Vega Sport Premium Protein'
  WHEN '0e98d9e2-c161-417b-ae19-83a71c5461d0' THEN 'Victoria''s Filet (6 oz)'
  WHEN 'a10973b1-cfaf-43d9-8b58-9284e0f59b28' THEN 'Vitamina D3 (2000 IU)'
  WHEN '5e525d74-3751-4ef1-9c19-e0d55e3f0c0f' THEN 'Shot de Vodka (1.5 oz)'
  WHEN 'e6d7017d-41b7-40db-bd87-79225a751dd8' THEN 'Berro (crudo)'
  WHEN 'e8c1e1dc-0f7b-4d2d-bb5c-438a71e9e124' THEN 'Whataburger'
  WHEN 'b4927de1-0212-402c-ae9a-ee9b86af1bb4' THEN 'Wheat Thins (puñado)'
  WHEN 'fbb15479-0cb8-42ad-be82-1016124b29df' THEN 'White Claw Hard Seltzer'
  WHEN '66604468-f75f-47e4-85db-15330841ff3a' THEN 'Vino Blanco (copa de 5 oz)'
  WHEN 'd10141bc-53e0-4483-883b-5635b4282b44' THEN 'Wings & Things'
  WHEN 'e0a225d2-1a48-4965-9f82-78d9739bd02e' THEN 'Cuajada de Queso Wisconsin'
  WHEN '80cb1e89-edc5-4ba0-90e2-9cd3bec14d13' THEN 'Salsa Worcestershire'
  WHEN 'b1633fb6-b76f-40ce-b6e5-c09500042d60' THEN 'Zaxby''s Crinkle Fries'
  WHEN 'c076520b-efb7-4514-9a15-a8be5142db39' THEN 'Suplemento ZMA'
  WHEN '9dfdaaa8-c2be-4f86-89c4-897e30531278' THEN 'Sopa Zuppa Toscana'
  ELSE name_es
END
WHERE id IN ('0c5ef4de-5370-459d-b279-7d24edf22810','e1880e63-ec14-4351-8d08-784772f899b8','68fde5d4-728e-4284-853a-6a37c3f453c2','cb9b939b-7f01-4988-809e-3094d8a9b020','dad41437-e6ff-4e8d-b798-30047e9cb8df','a193cfc4-9a25-4af1-acd3-2af61f843f6a','45a3749a-5fdc-4513-aa05-3efc224fe005','03e78a53-e03d-4a66-b1f9-08586ba806bb','3b37a067-1b94-40f2-bf0d-528bd345ec3f','fe9f1d46-10e6-498a-9b39-fecac186bebf','d0fca7d0-2059-40e9-848e-8d0aca91b302','ecf57aac-4688-47ed-b2c3-73d829e9ae35','c6503907-1fbf-4133-bdc7-53c27a9459b3','55c18409-255e-44d7-936b-3cc42407620e','a338d77f-ef9e-4ef1-be20-81c8f0036f45','d6491f7a-e3da-4e30-b000-27ffbff79199','f73e68be-832e-4254-91ee-9b73425596d9','c3d5d1bc-9af9-4a17-bd1b-7ede0422dcab','a525042b-692d-4bd1-b8c4-3e1c74005330','fa6371cc-bc2c-4a5c-8bac-5bc7d6e69d5a','f6459081-e931-4ab0-8a00-5ee5ddc4d6b5','ca43926b-0955-42fe-93ba-b5a56b981fe0','eaa17cbd-b343-4133-acea-3da245a7a2fa','ef57590d-ae7e-4724-866d-0c268d093f55','c1261a1c-c93a-46ef-b1de-fe97b86eda40','b2324666-5052-481a-98ba-63aa1cfdebc6','fde6d0d6-8449-403b-9cf6-feecaf669a19','4783d2c5-2b33-4c87-992a-b5c40f8bf664','ee9c7f57-fc52-4168-b436-3ce28cc2c8f3','2c453ede-4a15-4931-bc0d-3d95a12dd410','883cec21-73d5-49a0-97ac-c9d0f8af9ee9','01ca32e5-d17c-4980-905f-8986231fcb6c','910520ae-f245-4873-bb79-d6db3f9773de','d7fbda32-6fe3-49bd-a06e-11be738b3376','f2bb1ec4-9c86-4599-a15f-f52b8a654d2e','f9c7c942-d8e0-4a1f-aa40-90b735e1a3c3','61a82e2f-f7ec-4494-bbce-a964294c397e','bc790c3a-4fed-4518-a277-7790e6e1bb64','538a3cbf-6c3b-4a51-9bf7-ec95d69b04e6','b3288a96-dfd8-48f2-8de5-a62e51f0cc1f','ae6f4949-7366-41ac-a508-bb88ca197dd4','fe1b498d-cbbe-4c01-b4a6-d8842885c473','b91d39db-8d07-4a89-bf8c-814de1bc42c4','2c161d14-8012-43c5-8175-2ca89c4379a0','932feffe-5d04-471e-b48f-161acd802fa8','402c24f0-9b47-43c4-b77a-6c47cf113902','9dfe8083-3c25-4de3-bc15-de2e746cc222','75bebdcc-ba31-4a7d-b4f7-df46581e4351','afcb3153-938e-4bb4-9417-b80412f45f7d','1c805936-0b5b-4eb5-a636-d131f0a0c78b','c3ddda7c-3bd9-4ef8-9e92-690684e78266','7b419f35-fab3-4e10-a241-c5d6a28b929d','a8c58f26-312a-4fb8-9551-c6710ffe3f3c','069421e6-7540-4f73-8ee6-454ea7ddbedb','ec669e08-2478-4f10-8e73-337e93e7ac48','c0743069-0fc0-40e8-bc67-d38210616c9d','f7b68b03-2fd5-46e9-a449-ddf5b7efa0df','7a9f6449-212f-4040-a9db-cea78e70feba','fcf2d629-a3e6-4093-b826-21e20f62ac87','479b6083-3848-405d-9871-deec4a9cc691','b64de5a8-e005-4a5c-8ce8-4e501befa3d6','70434568-563c-4c7b-9256-9113c67da7b4','20cf5171-4064-43e8-9bd1-48f9bf3d9b89','adc6cfce-99c6-4815-8d9d-f09155d825ca','ff9338c8-20c2-423f-92d7-46641185a865','c58aa5dd-ca9c-42d0-8322-99c312d5db24','544360ea-920b-4f8e-9c01-53fd90ce77af','01058f4d-d849-4bf7-9f39-df9368d55de3','a755082f-6992-428d-854a-cbbb6f7f578a','0e98d9e2-c161-417b-ae19-83a71c5461d0','a10973b1-cfaf-43d9-8b58-9284e0f59b28','5e525d74-3751-4ef1-9c19-e0d55e3f0c0f','e6d7017d-41b7-40db-bd87-79225a751dd8','e8c1e1dc-0f7b-4d2d-bb5c-438a71e9e124','b4927de1-0212-402c-ae9a-ee9b86af1bb4','fbb15479-0cb8-42ad-be82-1016124b29df','66604468-f75f-47e4-85db-15330841ff3a','d10141bc-53e0-4483-883b-5635b4282b44','e0a225d2-1a48-4965-9f82-78d9739bd02e','80cb1e89-edc5-4ba0-90e2-9cd3bec14d13','b1633fb6-b76f-40ce-b6e5-c09500042d60','c076520b-efb7-4514-9a15-a8be5142db39','9dfdaaa8-c2be-4f86-89c4-897e30531278');
