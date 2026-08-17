import re

raw_data = """
OZW-35B-19647336	ABN-20260816-3A28C0	Médéa	Berrouaghia	cv:noir x1	0.00	2026-08-16 19:52:23	2026-08-17 14:01:03	2100.00	0	0	0	0	0	0	Livraison
OZW-35B-19644820	ABN-20260816-7C2B42	Skikda	Azzaba	cv:gris x1	0.00	2026-08-16 18:13:08	2026-08-17 17:23:57	1800.00	0	0	0	0	0	0	LivraisonStop Desk
OZW-35B-19639856	ABN-20260816-189392	Alger	Reghaia	cv:bordeaux x1	0.00	2026-08-16 16:11:11	2026-08-17 15:57:56	1650.00	0	0	0	0	0	0	LivraisonStop Desk
OZW-35B-19629661	ABN-20260816-7FC448	Relizane	Zemmoura	cv:bordeaux x1, cv:noir x2	0.00	2026-08-16 11:47:35	2026-08-17 13:58:08	4301.00	0	0	0	0	0	0	Livraison
OZW-35B-19629379	ABN-20260815-073114	Tipaza	Tipaza	cv:noir x1	0.00	2026-08-16 11:38:14	2026-08-17 17:07:54	1950.00	0	0	0	0	0	0	Livraison
OZW-35B-19629252	ABN-20260815-56C344	Oran	Bir El Djir	cv:bordeaux x1 | cv:bleu x1 | cv:noir x1 | cv:gris x1	0.00	2026-08-16 11:34:35	2026-08-17 17:57:02	4800.00	0	0	0	0	0	0	LivraisonStop Desk
OZW-35B-19612309	35778999	Djelfa	Djelfa	Coussin de voyage noir	1.00	2026-08-15 19:31:04	2026-08-17 15:00:20	1900.00	0	0	0	0	0	0	LivraisonStop Desk
OZW-35B-19605904	ABN-20260815-77FDEF	Jijel	Taher	cv:bleu x1 | cv:bordeaux x2 | cv:gris x1	0.00	2026-08-15 17:12:04	2026-08-16 14:26:07	5000.00	0	0	0	0	0	0	Livraison
OZW-35B-19592797	ABN-20260815-C29F63	Oum El Bouaghi	Ain Beida	cv:gris x1 | cv:bordeaux x1 | cv:bleu x1	0.00	2026-08-15 13:05:06	2026-08-17 14:44:09	4301.00	0	0	0	0	0	0	Livraison
OZW-35B-19590003	ABN-20260814-A35338	Annaba	El Bouni	cv:gris x1 | cv:bordeaux x1	0.00	2026-08-15 12:01:26	2026-08-16 15:36:03	2800.00	0	0	0	0	0	0	LivraisonStop Desk
OZW-35B-19589487	ABN-20260814-643E4A	Tizi Ouzou	Tizi Ouzou	cv:noir x1	0.00	2026-08-15 11:45:39	2026-08-16 17:14:49	1700.00	0	0	0	0	0	0	Livraison
OZW-35B-19588550	ABN-20260814-44A16D	Annaba	El Bouni	cv:noir x1 | cv:bleu x1 | cv:bordeaux x1	0.00	2026-08-15 11:27:41	2026-08-16 16:21:33	3901.00	0	0	0	0	0	0	LivraisonStop Desk
OZW-35B-19588391	ABN-20260814-440762	Laghouat	Laghouat	cv:noir x1	0.00	2026-08-15 11:23:18	2026-08-17 18:22:56	1900.00	0	0	0	0	0	0	LivraisonStop Desk
OZW-35B-19578515	ABN-20260814-E8EE49	El Bayadh	El Bayadh	cv:noir x1	0.00	2026-08-14 15:56:24	2026-08-17 12:17:52	2000.00	0	0	0	0	0	0	LivraisonStop Desk
OZW-35B-19578288	ABN-20260813-8ACB5E	Constantine	Ain Smara	cv:noir x1	0.00	2026-08-14 15:31:34	2026-08-16 16:56:29	2150.00	0	0	0	0	0	0	Livraison
OZW-35B-19558757	ABN-20260813-ACA9FB	Béchar	Bechar	cv:bleu x1	0.00	2026-08-13 14:39:19	2026-08-16 10:48:51	2000.00	0	0	0	0	0	0	LivraisonStop Desk
OZW-35B-19553950	ABN-20260812-F9E227	Oran	Oran	cv:noir x1	0.00	2026-08-13 12:10:41	2026-08-16 15:42:11	2150.00	0	0	0	0	0	0	Livraison
OZW-35B-19525453	ABN-20260812-8CB4C3	Souk Ahras	Souk Ahras	cv:noir x1 | cv:gris x1	0.00	2026-08-12 13:01:17	2026-08-16 17:57:37	2800.00	0	0	0	0	0	0	LivraisonStop Desk
OZW-35B-19448126	ABN-20260809-115962	Adrar	Zaouiet Kounta	cv:gris x1	0.00	2026-08-09 18:41:12	2026-08-16 09:21:54	2850.00	0	0	0	0	0	0	Livraison
OZW-35B-18473402	ABN-20260705-8FF0D5	Tindouf	Tindouf	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-12 19:46:55	2026-07-12 20:16:55	2000.00	600	0	0	0	0	1400	LivraisonSTOP DESK
OZW-35B-18500779	ORD-20260706-9E2A98	Ain Salah	In Salah	Coussin de Voyage (Noir) x1 | Coussin de Voyage (Rose Poudré) x1	0.00	2026-07-14 09:01:20	2026-07-14 12:59:43	3500.00	1000	0	0	0	0	2500	LivraisonSTOP DESK
OZW-35B-18505035	ABN-20260707-785C7E	Mechria	Naâma	Coussin de Voyage (Couleur: Bordeaux) x1	0.00	2026-07-12 10:59:15	2026-07-12 12:31:11	2000.00	600	0	0	0	0	1400	LivraisonSTOP DESK
OZW-35B-18517235	ABN-20260707-EB34CF	El Ouricia	Sétif	Coussin de Voyage (Couleur: Rose Poudré) x1	0.00	2026-07-15 14:56:20	2026-07-16 11:16:46	2200.00	700	0	0	0	0	1500	Livraison
OZW-35B-18535498	ABN-20260707-B750D0	Les Eucalyptus	Alger	Coussin de Voyage (P1: Couleur: Noir | P2: Couleur: Rose Poudré) x2	0.00	2026-07-14 14:52:55	2026-07-15 09:17:23	2900.00	450	0	0	0	0	2450	Livraison
OZW-35B-18564139	ABN-20260708-141665	Cheraga	Alger	Coussin de Voyage (P1: Couleur: Rose Poudré | P2: Couleur: Noir) x2	0.00	2026-07-15 20:43:45	2026-07-16 09:04:47	2900.00	450	0	0	0	0	2450	Livraison
OZW-35B-18564365	ABN-20260708-771186	El Bouni	Annaba	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-13 16:20:24	2026-07-14 08:47:37	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18575794	ABN-20260709-D04EAB	Staoueli	Alger	Coussin de Voyage (P1: Couleur: Gris | P2: Couleur: Rose Poudré) x2	0.00	2026-07-12 15:41:01	2026-07-13 10:19:47	2900.00	450	0	0	0	0	2450	Livraison
OZW-35B-18608029	ABN-20260708-840808	Ainmlila	Oum El Bouaghi	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-15 13:16:52	2026-07-15 15:40:17	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18608411	ABN-20260709-56D938	Rais Hamidou	Alger	Coussin de Voyage (P1: Couleur: Bordeaux | P2: Couleur: Gris ) x2	0.00	2026-07-19 00:43:36	2026-07-19 08:21:46	2900.00	450	0	0	0	0	2450	Livraison
OZW-35B-18610386	ABN-20260710-08ACF9	Hassi Messaoud	Ouargla	Coussin de Voyage (P1: Couleur: Rose Poudré | P2: Couleur: Bleu | P3: Couleur: Bordeaux) x3	0.00	2026-07-15 12:07:23	2026-07-15 16:39:03	4001.00	500	0	0	0	0	3501	LivraisonSTOP DESK
OZW-35B-18610731	ABN-20260710-30E804	Baba Hassen	Alger	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-13 16:26:51	2026-07-14 14:45:37	1650.00	200	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18611021	ABN-20260710-33FB15	Adrar	Adrar	Coussin de Voyage (P1: Couleur: Bleu | P2: Couleur: Bleu ) x2	0.00	2026-07-15 19:19:20	2026-07-15 19:49:56	3100.00	700	0	0	0	0	2400	LivraisonSTOP DESK
OZW-35B-18613161	ABN-20260710-7F9F06	Ouled Fayet	Alger	Coussin de Voyage (P1: Couleur: Rose Poudré | P2: Couleur: Bleu | P3: Couleur: Gris ) x3	0.00	2026-07-13 13:59:44	2026-07-14 11:15:53	4001.00	450	0	0	0	0	3551	Livraison
OZW-35B-18651437	ABN-20260712-D58720	Tamanghasset	Tamanrasset	Coussin de Voyage (Gris ) x1 | Coussin de Voyage (Bleu ) x1	0.00	2026-07-21 09:41:10	2026-07-21 16:39:32	3400.00	1000	0	0	0	0	2400	LivraisonSTOP DESK
OZW-35B-18654068	ABN-20260710-C16985	Sour El Ghozlane	Bouira	Coussin de Voyage (Couleur: Bordeaux) x1	0.00	2026-07-13 12:59:22	2026-07-14 10:43:51	2100.00	650	0	0	0	0	1450	Livraison
OZW-35B-18654254	ABN-20260712-C153DA	Boukadir	Chlef	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-13 13:09:05	2026-07-14 10:35:26	2200.00	700	0	0	0	0	1500	Livraison
OZW-35B-18656528	ORD-20260712-A2EE0C	Zeralda	Alger	Coussin de Voyage (Rose Poudré) x1 +rangement 6pcs	1.00	2026-07-13 12:02:41	2026-07-13 14:11:15	2850.00	200	0	0	0	0	2650	LivraisonSTOP DESK
OZW-35B-18657029	ABN-20260712-08DBCA	Messerghin	Oran	Coussin de Voyage (Couleur: Bleu ) x1	0.00	2026-07-14 19:08:44	2026-07-15 12:00:12	2150.00	700	0	0	0	0	1450	Livraison
OZW-35B-18660500	5282992	Biskra	Biskra	Coussin 2 bleu	1.00	2026-07-15 11:56:11	2026-07-15 13:17:55	2700.00	450	0	0	0	0	2250	LivraisonSTOP DESK
OZW-35B-18678292	ABN-20260713-1529C9	Lakhdaria	Bouira	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-15 09:15:57	2026-07-15 11:19:09	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18678732	ABN-20260713-03E6CF	Blida	Blida	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-14 12:28:57	2026-07-15 08:42:28	1950.00	500	0	0	0	0	1450	Livraison
OZW-35B-18679372	ABN-20260713-DCF18B	Bejaia	Béjaïa	Coussin de Voyage (P1: Couleur: Bordeaux | P2: Couleur: Gris ) x2	0.00	2026-07-14 14:14:22	2026-07-14 16:06:24	2800.00	350	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18679620	ABN-20260713-0051CA	Bou Saada	M'Sila	Coussin de Voyage (Rose Poudré) x1	0.00	2026-07-16 09:32:57	2026-07-16 09:40:02	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18679626	ABN-20260712-5C5CA7	Boumerdes	Boumerdès	Coussin de Voyage (Couleur: Bleu ) x1	0.00	2026-07-14 17:09:06	2026-07-14 19:05:11	1750.00	300	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18679680	ABN-20260712-068B43	Bordj El Bahri	Alger	Coussin de Voyage (P1: Couleur: Rose Poudré | P2: Couleur: Noir) x2	0.00	2026-07-14 12:43:09	2026-07-15 08:58:41	2900.00	450	0	0	0	0	2450	Livraison
OZW-35B-18679736	ABN-20260712-836782	Jijel	Jijel	Coussin de Voyage (Couleur: Gris ) x1	0.00	2026-07-14 16:37:42	2026-07-15 11:41:56	2200.00	750	0	0	0	0	1450	Livraison
OZW-35B-18680019	ORD-20260713-685AE5	Mostaganem	Mostaganem	Coussin de Voyage (Gris ) x1 | Coussin de Voyage (Bordeaux) x1	0.00	2026-07-16 11:44:53	2026-07-16 12:54:25	2800.00	350	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18680033	ABN-20260712-872730	Zemmouri	Boumerdès	Coussin de Voyage (P1: Couleur: Noir | P2: Couleur: Noir) x2	0.00	2026-07-14 11:38:01	2026-07-15 10:26:49	2950.00	500	0	0	0	0	2450	Livraison
OZW-35B-18680055	ABN-20260712-2381ED	Tiaret	Tiaret	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-15 17:56:50	2026-07-16 16:11:18	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18680097	ABN-20260713-55CD08	Annaba	Annaba	Coussin de Voyage (Couleur: Gris ) x1	0.00	2026-07-14 13:28:05	2026-07-15 09:09:26	2200.00	720	0	0	0	0	1480	Livraison
OZW-35B-18684379	ABN-20260713-632A3D	El Meniaa	El Meniaa	Coussin de Voyage (P1: Couleur: Rose Poudré | P2: Couleur: Gris ) x2	0.00	2026-07-18 09:45:37	2026-07-18 12:57:22	2900.00	500	0	0	0	0	2400	LivraisonSTOP DESK
OZW-35B-18684765	ABN-20260713-80110A	Corso	Boumerdès	Coussin de Voyage (P1: Couleur: Gris | P2: Couleur: Gris ) x2	0.00	2026-07-14 12:13:05	2026-07-15 08:46:46	2950.00	500	0	0	0	0	2450	Livraison
OZW-35B-18684904	ABN-20260712-97522B	Adrar	Adrar	Coussin de Voyage (P1: Couleur: Gris | P2: Couleur: Bleu ) x2	0.00	2026-07-21 11:13:22	2026-07-21 13:05:04	3100.00	700	0	0	0	0	2400	LivraisonSTOP DESK
OZW-35B-18704054	ABN-20260713-D64841	Tolga	Biskra	Coussin de Voyage (Couleur: Rose Poudré) x1	0.00	2026-07-15 20:57:43	2026-07-16 11:45:05	2350.00	900	0	0	0	0	1450	Livraison
OZW-35B-18704089	ABN-20260713-C47FAD	Tindouf	Tindouf	Coussin de Voyage (P1: Couleur: Gris | P2: Couleur: Gris ) x2	0.00	2026-07-19 11:12:58	2026-07-19 13:09:11	3000.00	600	0	0	0	0	2400	LivraisonSTOP DESK
OZW-35B-18704137	ABN-20260713-5C581A	Ainmlila	Oum El Bouaghi	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-15 11:56:07	2026-07-15 12:49:25	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18704507	ABN-20260714-A2D661	Timimoun	Timimoun	Coussin de Voyage (Couleur: Bleu ) x1	0.00	2026-07-18 11:38:45	2026-07-18 20:13:03	2100.00	700	0	0	0	0	1400	LivraisonSTOP DESK
OZW-35B-18704575	ABN-20260714-4CD65C	Tindouf	Tindouf	Coussin de Voyage (Couleur: Bleu ) x1	0.00	2026-07-18 09:36:26	2026-07-18 12:56:56	2000.00	600	0	0	0	0	1400	LivraisonSTOP DESK
OZW-35B-18705123	ORD-20260714-F994AE	Oran	Oran	Coussin de Voyage (Noir) x1 | Coussin de Voyage (Bleu ) x1 | Coussin de Voyage (Rose Poudré) x1 | Coussin de Voyage (bordeaux ) x1	1.00	2026-07-15 17:35:21	2026-07-16 13:40:08	4800.00	350	0	0	0	0	4450	LivraisonSTOP DESK
OZW-35B-18705351	ABN-20260714-0A7FA3	Lioua	Biskra	Coussin de Voyage (Couleur: Noir) x1	1.00	2026-07-16 11:11:02	2026-07-16 15:07:38	2350.00	900	0	0	0	0	1450	Livraison
OZW-35B-18711027	ORD-20260714-C17502	Chlef	Chlef	Coussin de Voyage (Bleu ) x1	1.00	2026-07-18 16:32:49	2026-07-19 08:51:12	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18720098	4789765	Ain Benian	Alger	Rangement 6pcs beige	1.00	2026-07-16 13:41:25	2026-07-18 09:48:28	1600.00	450	0	0	0	0	1150	Livraison
OZW-35B-18733125	ABN-20260714-98AC80	Laghouat	Laghouat	Coussin de Voyage (P1: Couleur: Gris | P2: Couleur: Rose Poudré) x2	0.00	2026-07-16 17:44:47	2026-07-18 10:54:08	2900.00	450	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18733216	ABN-20260714-22557F	El Khroub	Constantine	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-16 13:40:03	2026-07-16 16:17:07	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18733472	ABN-20260714-50C3AA	Kolea	Tipaza	Coussin de Voyage (Couleur: Bleu ) x1	0.00	2026-07-16 14:45:00	2026-07-18 09:24:17	1950.00	500	0	0	0	0	1450	Livraison
OZW-35B-18734399	ABN-20260715-366DFC	Medea	Médéa	Coussin de Voyage (Couleur: Noir) x1	1.00	2026-07-16 13:29:10	2026-07-18 08:50:33	2100.00	650	0	0	0	0	1450	Livraison
OZW-35B-18734499	ABN-20260715-6622DF	El Bouni	Annaba	Coussin de Voyage (Couleur: Rose Poudré) x1	0.00	2026-07-16 14:42:10	2026-07-16 16:13:41	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18735429	ABN-20260715-D8DC82	Tiaret	Tiaret	Coussin de Voyage (Couleur: Gris ) x1	0.00	2026-07-16 14:16:08	2026-07-16 15:53:06	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18736592	ABN-20260715-1C4F71	Boumerdes	Boumerdès	Coussin de Voyage (Bleu ) x1	0.00	2026-07-16 12:17:50	2026-07-18 11:55:00	1950.00	500	0	0	0	0	1450	Livraison
OZW-35B-18736882	ABN-20260715-6EEBFF	Ain Beida	Oum El Bouaghi	Coussin de Voyage (Gris ) x1 | Coussin de Voyage (Bordeaux) x1 | Coussin de Voyage (Bleu ) x1	0.00	2026-07-19 10:25:39	2026-07-19 16:07:28	3901.00	350	0	0	0	0	3551	LivraisonSTOP DESK
OZW-35B-18736994	ABN-20260709-673795	Reggane	Adrar	Coussin de Voyage (Couleur: Gris ) x1	0.00	2026-07-20 19:09:24	2026-07-21 11:35:10	2800.00	1450	0	0	0	0	1350	Livraison
OZW-35B-18737243	ABN-20260711-44F35D	Ouled Moussa	Boumerdès	Coussin de Voyage (Couleur: Rose Poudré) x1	0.00	2026-07-18 16:53:08	2026-07-19 09:20:03	1950.00	500	0	0	0	0	1450	Livraison
OZW-35B-18738715	ABN-20260714-A4B717	Setif	Sétif	Coussin de Voyage (Gris ) x1 | Coussin de Voyage (Bleu ) x1	0.00	2026-07-18 10:55:50	2026-07-18 20:38:27	2800.00	350	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18738832	ORD-20260715-0FF840	Msila	M'Sila	Coussin de Voyage (Rose Poudré) x1 | Coussin de Voyage (Gris ) x2	0.00	2026-07-16 12:00:27	2026-07-16 12:26:21	3901.00	350	0	0	0	0	3551	LivraisonSTOP DESK
OZW-35B-18739298	ABN-20260715-73838D	Sidi Bel Abbes	Sidi Bel Abbès	Coussin de Voyage (P1: Couleur: Noir | P2: Couleur: Bleu ) x2	0.00	2026-07-19 13:25:08	2026-07-19 14:15:46	2800.00	350	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18739371	ORD-20260715-39C478	Jijel	Jijel	Coussin de Voyage (Noir) x1 | Coussin de Voyage (Rose Poudré) x1 + mizane	1.00	2026-07-16 15:48:18	2026-07-18 14:59:48	4000.00	350	0	0	0	0	3650	LivraisonSTOP DESK
OZW-35B-18742785	ORD-20260715-8F7E38	Boutlelis	Oran	Coussin de Voyage (Noir) x1 | Coussin de Voyage (Bleu ) x1	0.00	2026-07-16 16:30:06	2026-07-18 11:09:05	2800.00	700	0	0	0	0	2100	Livraison
OZW-35B-18742902	ORD-20260715-FAB104	Collo	Skikda	Coussin de Voyage (Bleu ) x1	0.00	2026-07-17 00:17:40	2026-07-18 08:58:41	2200.00	720	0	0	0	0	1480	Livraison
OZW-35B-18743041	ABN-20260715-C168D1	Medea	Médéa	Coussin de Voyage (Noir) x1 | Coussin de Voyage (Gris ) x1 | Coussin de Voyage (Bleu ) x1 | Coussin de Voyage (Rose Poudré) x1	0.00	2026-07-18 15:20:06	2026-07-18 15:35:35	4800.00	350	0	0	0	0	4450	LivraisonSTOP DESK
OZW-35B-18743224	ABN-20260715-DD319A	Ain Benian	Alger	Coussin de Voyage (Noir) x1 | Coussin de Voyage (Gris ) x1 | Coussin de Voyage (Bleu ) x1 | Coussin de Voyage (Rose Poudré) x1	0.00	2026-07-16 10:47:07	2026-07-18 09:48:28	4900.00	450	0	0	0	0	4450	Livraison
OZW-35B-18749415	null	Bouinan	Blida	Noir	1.00	2026-07-16 15:22:27	2026-07-18 09:44:31	1700.00	500	0	0	0	0	1200	Livraison
OZW-35B-18762662	ABN-20260715-943D67	Djelfa	Djelfa	Coussin de Voyage (Couleur: Rose Poudré) x1	0.00	2026-07-18 11:24:18	2026-07-18 16:43:19	1900.00	450	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18765064	ABN-20260715-3AB618	Medea	Médéa	Coussin de Voyage (Noir) x1 | Coussin de Voyage (Bordeaux) x1	0.00	2026-07-19 11:08:32	2026-07-19 13:03:44	2800.00	350	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18765093	ABN-20260715-CEF324	Djasr Kasentina	Alger	Coussin de Voyage (Couleur: Gris ) x1	0.00	2026-07-18 19:25:47	2026-07-19 10:51:16	1900.00	450	0	0	0	0	1450	Livraison
OZW-35B-18765153	ABN-20260715-CFE1B4	Bordj Bou Arreridj	Bordj Bou Arreridj	Coussin de Voyage (Bordeaux) x1 | Coussin de Voyage (Gris) x1	0.00	2026-07-18 16:21:07	2026-07-18 16:33:53	2800.00	350	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18765210	ABN-20260716-FA5553	Ouargla	Ouargla	Coussin de Voyage (Couleur: Rose Poudré) x1	0.00	2026-07-19 19:05:21	2026-07-19 19:36:04	1900.00	500	0	0	0	0	1400	LivraisonSTOP DESK
OZW-35B-18765345	ABN-20260716-F469BF	Telerghma	Mila	Coussin de Voyage (Noir) x2 | Coussin de Voyage (Bordeaux) x2	0.00	2026-07-18 17:45:15	2026-07-19 09:57:25	5200.00	750	0	0	0	0	4450	Livraison
OZW-35B-18765430	ABN-20260716-D9FB69	Messelmoun	Tipaza	Coussin de Voyage (Noir) x1 | Coussin de Voyage (gris) x1	1.00	2026-07-20 12:46:15	2026-07-21 10:15:38	2950.00	500	0	0	0	0	2450	Livraison
OZW-35B-18767302	ABN-20260716-9412EB	Mechria	Naâma	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-19 12:57:11	2026-07-20 13:17:02	2000.00	600	0	0	0	0	1400	LivraisonSTOP DESK
OZW-35B-18768290	ORD-20260716-DE2556	Khenchela	Khenchela	Coussin de Voyage (Rose Poudré) x1	0.00	2026-07-19 22:55:43	2026-07-20 09:03:36	2200.00	850	0	0	0	0	1350	Livraison
OZW-35B-18770622	ABN-20260716-01A8E5	El Khroub	Constantine	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-19 10:49:37	2026-07-19 10:49:37	2150.00	700	0	0	0	0	1450	Livraison
OZW-35B-18770851	ABN-20260715-8AE7BE	Bouira	Bouira	Coussin de Voyage (Couleur: Bleu ) x1	0.00	2026-07-20 14:43:54	2026-07-20 16:37:59	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18770979	ABN-20260713-5A67B4	Batna	Batna	Coussin de Voyage (Noir) x1	0.00	2026-07-18 21:38:34	2026-07-19 11:32:40	2200.00	720	0	0	0	0	1480	Livraison
OZW-35B-18772494	ABN-20260716-5C6833	Sidi Okba	Biskra	Coussin de Voyage (P1: Couleur: Rose Poudré | P2: Couleur: Bleu ) x2	0.00	2026-07-20 12:13:17	2026-07-20 14:20:25	3350.00	900	0	0	0	0	2450	Livraison
OZW-35B-18786338	ABN-20260717-8BE0F6	Adrar	Adrar	Coussin de Voyage (Rose Poudré) x1 | Coussin de Voyage (Bleu) x1 + mizane	1.00	2026-07-21 09:09:23	2026-07-21 13:05:04	4500.00	700	0	0	0	0	3800	LivraisonSTOP DESK
OZW-35B-18786578	ABN-20260717-82BCFC	Isser	Boumerdès	Coussin de Voyage (Gris) x1 | Coussin de Voyage (Noir) x1 | Coussin de Voyage (Bordeaux) x1 | Coussin de Voyage (Rose Poudré) x1	0.00	2026-07-19 11:44:15	2026-07-20 09:22:02	4950.00	500	0	0	0	0	4450	Livraison
OZW-35B-18786702	ABN-20260717-415CF5	Laghouat	Laghouat	Coussin de Voyage (Gris) x1 | Coussin de Voyage (Rose Poudré) x1	0.00	2026-07-19 19:14:09	2026-07-20 12:19:24	2900.00	450	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18786770	ABN-20260716-83CA03	Drean	El Tarf	Coussin de Voyage (Noir) x1 | Coussin de Voyage (rose ) x1	1.00	2026-07-21 16:42:16	2026-07-22 10:34:48	3300.00	850	0	0	0	0	2450	Livraison
OZW-35B-18788226	ABN-20260716-1841A2	Batna	Batna	Coussin de Voyage (Rose Poudré) x2	0.00	2026-07-19 21:59:30	2026-07-20 11:33:28	3200.00	720	0	0	0	0	2480	Livraison
OZW-35B-18788236	ABN-20260717-1CAE0F	Ben Freha	Oran	Coussin de Voyage (Noir) x1 | Coussin de Voyage (Bleu) x1	0.00	2026-07-19 18:53:32	2026-07-20 11:14:32	3150.00	700	0	0	0	0	2450	Livraison
OZW-35B-18788258	ABN-20260717-5CAA64	Oran	Oran	Coussin de Voyage (Bordeaux) x1 | Coussin de Voyage (Noir) x1	0.00	2026-07-20 00:00:34	2026-07-20 09:29:31	3150.00	700	0	0	0	0	2450	Livraison
OZW-35B-18788401	ABN-20260713-675395	Constantine	Constantine	Coussin de Voyage (Noir) x1 | Coussin de Voyage (Bordeaux) x1	0.00	2026-07-19 16:52:30	2026-07-20 10:03:05	3150.00	700	0	0	0	0	2450	Livraison
OZW-35B-18789152	ABN-20260717-040B7B	Ain Djasser	Batna	Coussin de Voyage (Couleur: Rose Poudré) x1	0.00	2026-07-20 17:35:45	2026-07-21 09:39:15	2200.00	720	0	0	0	0	1480	Livraison
OZW-35B-18789334	ABN-20260717-6511D1	Laghouat	Laghouat	Coussin de Voyage (Couleur: Rose Poudré) x1	0.00	2026-07-20 10:14:40	2026-07-20 12:19:24	1900.00	450	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18801377	ABN-20260717-227B2A	Bethioua	Oran	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-19 15:42:44	2026-07-20 11:41:57	2150.00	700	0	0	0	0	1450	Livraison
OZW-35B-18801398	ABN-20260717-5C687F	Tiaret	Tiaret	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-20 10:55:34	2026-07-20 14:14:07	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18803379	ABN-20260717-35F746	Ras El Oued	Bordj Bou Arreridj	Coussin Orthopedique gris x1	1.00	2026-07-19 17:21:57	2026-07-20 16:23:07	2800.00	350	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18803598	ABN-20260718-328DDC	Maghnia	Tlemcen	Coussin de Voyage (P1: Couleur: Bleu | P2: Couleur: Noir) x2	0.00	2026-07-19 21:34:01	2026-07-20 10:41:55	3200.00	720	0	0	0	0	2480	Livraison
OZW-35B-18803683	ABN-20260718-8DDF42	Setif	Sétif	Coussin de Voyage (Rose Poudré) x1 | Coussin de Voyage (Bleu) x1 | Coussin de Voyage (Bordeaux) x1	0.00	2026-07-20 13:04:33	2026-07-20 19:26:37	3901.00	350	0	0	0	0	3551	LivraisonSTOP DESK
OZW-35B-18803899	ABN-20260718-EC9A30	El Biar	Alger	Coussin de Voyage (Gris) x2 | Coussin de Voyage (Bleu) x1 | Coussin de Voyage (Rose Poudré) x1	0.00	2026-07-20 00:30:34	2026-07-20 09:32:04	4900.00	450	0	0	0	0	4450	Livraison
OZW-35B-18804078	ABN-20260718-D3A78F	Beni Tamou	Blida	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-19 11:37:10	2026-07-20 08:52:17	1950.00	500	0	0	0	0	1450	Livraison
OZW-35B-18808771	ABN-20260717-606D32	El Meniaa	El Meniaa	Coussin de Voyage (Noir) x1 | Coussin de Voyage (Bordeaux) x1 | Coussin de Voyage (Rose Poudré) x1	1.00	2026-07-22 12:46:04	2026-07-22 20:04:29	3800.00	500	0	0	0	0	3300	LivraisonSTOP DESK
OZW-35B-18809103	367890	Laghouat	Laghouat	Rangement 6pcs rose	1.00	2026-07-19 18:50:37	2026-07-20 12:19:24	1650.00	450	0	0	0	0	1200	LivraisonSTOP DESK
OZW-35B-18811903	ORD-20260718-450A32	Annaba	Annaba	Coussin de Voyage (Bordeaux) x1 | Coussin Orthopédique bleu x1	1.00	2026-07-19 17:15:46	2026-07-20 09:03:33	3800.00	350	0	0	0	0	3450	LivraisonSTOP DESK
OZW-35B-18812275	ABN-20260718-89FFD0	Ain Youcef	Tlemcen	Coussin de Voyage (Couleur: Bleu ) x1	0.00	2026-07-20 14:21:11	2026-07-21 11:49:13	2200.00	720	0	0	0	0	1480	Livraison
OZW-35B-18812472	ABN-20260718-BAD770	Mila	Mila	Coussin de Voyage (Rose Poudré) x1 | Coussin de Voyage (Gris) x1	0.00	2026-07-19 17:25:59	2026-07-20 08:39:07	2800.00	350	0	0	0	0	2450	Livraison
OZW-35B-18825889	ABN-20260718-8FFE69	Birkhadem	Alger	Coussin de Voyage (Noir) x1 | Coussin de Voyage (Bleu) x1	0.00	2026-07-22 02:29:00	2026-07-22 10:03:25	2900.00	450	0	0	0	0	2450	Livraison
OZW-35B-18827237	ABN-20260718-9D6AC6	El Khroub	Constantine	Coussin de Voyage (Bordeaux) x1 | Coussin de Voyage (Bleu) x1 | Coussin de Voyage (Rose Poudré) x1 | Coussin de Voyage (Noir) x1	0.00	2026-07-20 13:55:31	2026-07-20 16:48:56	4800.00	350	0	0	0	0	4450	LivraisonSTOP DESK
OZW-35B-18839817	ABN-20260718-BC490F	Mostaganem	Mostaganem	Coussin de Voyage (Rose Poudré) x1 | Coussin de Voyage (Bleu) x1	0.00	2026-07-20 17:39:49	2026-07-20 19:02:34	2800.00	350	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18839851	ABN-20260719-D2D156	Merouana	Batna	Coussin de Voyage (Rose Poudré) x1 | Coussin de Voyage (Bleu) x1	0.00	2026-07-20 17:59:01	2026-07-21 11:37:45	3200.00	720	0	0	0	0	2480	Livraison
OZW-35B-18840066	ABN-20260719-EEA935	Ain Temouchent	Aïn Témouchent	Coussin de Voyage (Gris) x1 | Coussin de Voyage (Rose Poudré) x1	0.00	2026-07-20 14:57:13	2026-07-20 15:47:13	2800.00	350	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18840763	ABN-20260719-9779B7	Relizane	Relizane	Coussin de Voyage (Bleu ) x1 | Coussin de Voyage (Bleu ) x1	0.00	2026-07-20 11:49:58	2026-07-20 14:44:06	2800.00	350	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18849186	ABN-20260719-A142A8	Bouzareah	Alger	Coussin de Voyage (Noir) x1 | Coussin de Voyage (Rose Poudré) x1 | Coussin de Voyage (Bordeaux) x1	0.00	2026-07-20 10:47:01	2026-07-21 08:56:09	4001.00	450	0	0	0	0	3551	Livraison
OZW-35B-18852643	ABN-20260719-5F7D51	Guelma	Guelma	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-20 15:51:26	2026-07-20 16:07:01	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18853276	ABN-20260717-A669E5	Adrar	Adrar	Coussin de Voyage (Bordeaux) x4	0.00	2026-07-22 09:33:30	2026-07-22 13:07:23	4700.00	700	0	0	0	0	4000	LivraisonSTOP DESK
OZW-35B-18853372	ORD-20260719-249EBA	Adrar	Adrar	Coussin de Voyage (Noir) x2 | Coussin de Voyage (Gris ) x1 | Coussin de Voyage (Rose Poudré) x1	0.00	2026-07-22 09:33:32	2026-07-22 13:07:23	4700.00	700	0	0	0	0	4000	LivraisonSTOP DESK
OZW-35B-18853899	ABN-20260719-1C68F8	Birkhadem	Alger	Coussin de Voyage (Rose Poudré) x2 | Coussin de Voyage (Noir) x1 | Coussin de Voyage (Gris ) x1	0.00	2026-07-22 02:38:50	2026-07-22 10:03:25	3800.00	450	0	0	0	0	3350	Livraison
OZW-35B-18854653	ABN-20260717-6F1F1C	Azzaba	Skikda	Coussin de Voyage (Couleur: Gris ) x1	0.00	2026-07-20 14:00:08	2026-07-21 10:09:32	2200.00	720	0	0	0	0	1480	Livraison
OZW-35B-18870185	ABN-20260720-DB4241	Maghnia	Tlemcen	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-21 16:36:14	2026-07-22 09:39:46	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18870351	ABN-20260720-C042DB	Baraki	Alger	Coussin de Voyage (Bleu) x1 | Coussin de Voyage (Bordeaux) x1	0.00	2026-07-21 18:31:06	2026-07-22 09:00:44	2900.00	450	0	0	0	0	2450	Livraison
OZW-35B-18870492	ABN-20260719-99BF56	Tolga	Biskra	Coussin de Voyage (Rose Poudré) x1 | Coussin de Voyage (Bleu) x1	0.00	2026-07-23 12:11:34	2026-07-23 14:53:42	3350.00	900	0	0	0	0	2450	Livraison
OZW-35B-18871654	ABN-20260718-68BA58	Tizi Ouzou	Tizi Ouzou	Coussin de Voyage (Noir) x1 | Coussin de Voyage (Bleu ) x1	0.00	2026-07-23 11:21:10	2026-07-23 12:23:30	2800.00	350	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18871896	ABN-20260720-265E5F	El Oued	El Oued	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-22 12:15:07	2026-07-22 12:19:06	1800.00	500	0	0	0	0	1300	LivraisonSTOP DESK
OZW-35B-18872535	ABN-20260719-C28BCB	Tissemsilt	Tissemsilt	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-22 13:13:50	2026-07-22 13:40:22	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18875750	ORD-20260720-144076	Ksar Chellala	Tiaret	Coussin de Voyage (Noir) x1 | Coussin de Voyage (Gris ) x1	0.00	2026-07-22 20:45:41	2026-07-23 09:36:41	3200.00	820	0	0	0	0	2380	Livraison
OZW-35B-18879107	ABN-20260720-BEE0BF	Blida	Blida	Coussin de Voyage (Bordeaux) x1 | Coussin de Voyage (Noir) x1 | Coussin de Voyage (Bleu) x1	0.00	2026-07-22 15:30:13	2026-07-23 08:10:55	4051.00	500	0	0	0	0	3551	Livraison
OZW-35B-18880708	ABN-20260720-76AB46	Bir El Djir	Oran	Coussin de Voyage (Noir) x1 | Coussin de Voyage (Bleu) x1	0.00	2026-07-22 18:06:59	2026-07-23 10:52:01	3150.00	700	0	0	0	0	2450	Livraison
OZW-35B-18880988	ABN-20260717-1A243C	Messerghin	Oran	Coussin de Voyage (Gris ) x1 | Coussin de Voyage (Rose Poudré) x2 | Rangement des valises x1	0.00	2026-07-22 15:12:13	2026-07-23 10:55:03	5301.00	700	0	0	0	0	4601	Livraison
OZW-35B-18881168	ORD-20260720-ECAF62	El Milia	Jijel	Coussin de Voyage (Gris ) x1 | Balance x1	0.00	2026-07-23 11:18:50	2026-07-23 11:59:11	2800.00	350	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18881355	ORD-20260720-F3D355	Boumerdes	Boumerdès	Coussin de Voyage (Bleu ) x1 | Coussin de Voyage (Gris ) x1	0.00	2026-07-23 09:50:52	2026-07-23 09:52:18	2750.00	300	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18881531	ABN-20260720-5303C1	Boumerdes	Boumerdès	Coussin de Voyage (Bleu) x1 | Coussin de Voyage (Bordeaux) x1 | Coussin de Voyage (Gris) x1 | Coussin de Voyage (Noir) x1	0.00	2026-07-23 09:01:48	2026-07-23 09:52:18	4750.00	300	0	0	0	0	4450	Livraison
OZW-35B-18899189	ABN-20260720-BAF72D	Boufarik	Blida	cv:gris x1	0.00	2026-07-23 14:40:07	2026-07-23 15:42:18	1950.00	500	0	0	0	0	1450	Livraison
OZW-35B-18899266	ABN-20260720-E2697E	Bouira	Bouira	cv:noir x1	0.00	2026-07-22 12:39:42	2026-07-22 15:46:33	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18901074	ABN-20260720-B0B6FB	El Eulma	Sétif	cv:rose poudré x1	0.00	2026-07-23 11:57:42	2026-07-23 13:58:39	2800.00	350	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18901728	ABN-20260719-6A3BDF	Sedrata	Souk Ahras	cv:noir x1 | cv:bordeaux x1	0.00	2026-07-22 17:25:13	2026-07-23 10:36:58	3300.00	850	0	0	0	0	2450	Livraison
OZW-35B-18901944	ABN-20260721-D7A8BF	El Eulma	Sétif	cv:noir x1 | cv:gris x1 | cv:bordeaux x1 | cv:bleu x1 | cv:rose poudré x1	0.00	2026-07-23 18:08:32	2026-07-25 10:41:38	6200.00	700	0	0	0	0	5500	Livraison
OZW-35B-18902348	ABN-20260720-808707	El Biar	Alger	cv:rose poudré x1 | cv:bordeaux x1 | rv rose x1	1.00	2026-07-22 13:05:43	2026-07-23 07:57:54	4100.00	450	0	0	0	0	3650	Livraison
OZW-35B-18904815	ABN-20260721-67C648	Chlef	Chlef	cv:rose poudré x1	0.00	2026-07-23 10:27:55	2026-07-23 14:20:14	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18910952	ABN-20260720-28D2B6	Cheraga	Alger	co bleu*1	1.00	2026-07-23 20:22:39	2026-07-25 09:27:04	2800.00	450	0	0	0	0	2350	Livraison
OZW-35B-18913634	ABN-20260721-D105F2	Touggourt	Touggourt	cv:bordeaux x1	0.00	2026-07-25 18:21:25	2026-07-25 20:06:29	1900.00	500	0	0	0	0	1400	LivraisonSTOP DESK
OZW-35B-18918531	ABN-20260721-C971E2	El M'Ghair	El M'Ghair	cv:noir x1	0.00	2026-07-25 10:29:20	2026-07-25 13:17:58	1900.00	500	0	0	0	0	1400	LivraisonSTOP DESK
OZW-35B-18938060	ABN-20260722-0F1A8C	Tlemcen	Tlemcen	cv:bordeaux x1	0.00	2026-07-23 18:12:34	2026-07-25 09:17:22	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18409333	63738939	Bachedjerah	Alger	2 rangement de valise 6pcs	1.00	2026-07-05 14:04:52	2026-07-06 11:01:22	2900.00	450	0	0	0	0	2450	Livraison
OZW-35B-18169319	null	Remchi	Tlemcen	Coussin Noir	0.00	2026-06-28 15:46:20	2026-06-29 09:41:48	2200.00	720	0	0	0	0	1480	Livraison
OZW-35B-18510083	5373893	Tadjenanet	Mila	Coussin 2noir 1rose	1.00	2026-07-09 14:38:54	2026-07-11 08:44:13	0.00	750	0	0	0	0	-750	Livraison
OZW-35B-18298849	ORD-20260629-548543	Sétif	Sétif	Coussin bleu	1.00	2026-07-01 10:01:43	2026-07-01 11:57:44	2200.00	700	0	0	0	0	1500	Livraison
OZW-35B-18326422	6383839	Dhala	Oum El Bouaghi	Coussin bleu	1.00	2026-07-04 20:17:22	2026-07-05 12:59:43	2200.00	700	0	0	0	0	1500	Livraison
OZW-35B-18326473	6382929	Sidi Amer	Annaba	Coussin bleu	1.00	2026-07-05 15:51:50	2026-07-06 09:29:30	2200.00	720	0	0	0	0	1480	Livraison
OZW-35B-18415017	ORD-20260704-BC0C94	Douera	Alger	Coussin de Voyage (Bleu ) x1	0.00	2026-07-05 16:16:02	2026-07-06 11:58:24	1900.00	450	0	0	0	0	1450	Livraison
OZW-35B-18474834	ABN-20260705-62BA14	Tlemcen	Tlemcen	Coussin de Voyage (Bleu ) x1	1.00	2026-07-07 20:14:57	2026-07-08 10:31:45	2000.00	720	0	0	0	0	1280	Livraison
OZW-35B-18507606	ABN-20260706-4FCCFD	Medea	Médéa	Coussin de Voyage (Bleu ) x1 | Coussin de Voyage (Bordeaux) x1	0.00	2026-07-09 10:12:55	2026-07-09 11:59:29	2800.00	350	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18507590	ORD-20260707-2C2CDE	Chlef	Chlef	Coussin de Voyage (Bleu ) x1 | Coussin de Voyage (Bordeaux) x1 | Coussin de Voyage (Rose Poudré) x1	0.00	2026-07-11 16:40:54	2026-07-12 08:55:18	3901.00	350	0	0	0	0	3551	LivraisonSTOP DESK
OZW-35B-18488340	ABN-20260702-4DF9F1	El Bayadh	El Bayadh	Coussin de Voyage (Bordeaux) x1 | Coussin de Voyage (Noir) x1	1.00	2026-07-12 18:44:30	2026-07-12 20:10:29	3000.00	600	0	0	0	0	2400	LivraisonSTOP DESK
OZW-35B-18535389	ABN-20260707-06A2EC	Tebessa	Tébessa	Coussin de Voyage (Bordeaux) x1 | Coussin de Voyage (Rose Poudré) x1	0.00	2026-07-12 14:36:53	2026-07-12 16:10:15	2800.00	350	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18370483	ABN-20260703-57BA0C	Es Senia	Oran	Coussin de Voyage (Couleur: Bleu ) x1	0.00	2026-07-05 18:00:30	2026-07-06 14:12:01	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18371013	ABN-20260702-390688	Boumerdes	Boumerdès	Coussin de Voyage (Couleur: Bleu ) x1	0.00	2026-07-07 10:58:16	2026-07-07 12:40:32	1750.00	300	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18535789	ABN-20260708-0E56C5	Touggourt	Touggourt	Coussin de Voyage (Couleur: Bleu ) x1	0.00	2026-07-13 10:51:59	2026-07-13 10:58:00	1900.00	500	0	0	0	0	1400	LivraisonSTOP DESK
OZW-35B-18356204	ABN-20260701-7B0576	Biskra	Biskra	Coussin de Voyage (Couleur: Bordeaux) x1	0.00	2026-07-08 17:49:37	2026-07-09 11:20:15	2300.00	900	0	0	0	0	1400	Livraison
OZW-35B-18354674	ABN-20260701-188C7E	Mostaganem	Mostaganem	Coussin de Voyage (Couleur: Gris ) x1	0.00	2026-07-05 20:20:07	2026-07-06 11:49:27	2200.00	720	0	0	0	0	1480	Livraison
OZW-35B-18440357	ABN-20260704-0E8FAB	Mascara	Mascara	Coussin de Voyage (Couleur: Gris ) x1	0.00	2026-07-06 15:03:26	2026-07-07 09:49:55	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18451664	ABN-20260705-8B62D2	Arzew	Oran	Coussin de Voyage (Couleur: Gris ) x1	1.00	2026-07-06 13:52:14	2026-07-06 15:45:18	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18474239	ABN-20260705-D594D3	Ghardaia	Ghardaïa	Coussin de Voyage (Couleur: Gris ) x1	1.00	2026-07-09 10:18:27	2026-07-09 15:41:57	1900.00	500	0	0	0	0	1400	LivraisonSTOP DESK
OZW-35B-18610620	ABN-20260710-9359B5	Sidi Bel Abbes	Sidi Bel Abbès	Coussin de Voyage (Couleur: Gris ) x1	0.00	2026-07-13 12:05:17	2026-07-13 13:33:24	2200.00	720	0	0	0	0	1480	Livraison
OZW-35B-18327888	ORD-20260629-B49433	Maghnia	Tlemcen	Coussin de Voyage (Couleur: Noir) x1	1.00	2026-07-05 12:29:20	2026-07-05 12:52:50	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18355756	ABN-20260701-0C1BAE	Tizi Ouzou	Tizi Ouzou	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-07 08:54:44	2026-07-07 12:26:38	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18355775	ABN-20260701-F1D5FF	Medea	Médéa	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-06 15:15:39	2026-07-06 15:22:50	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18356968	ABN-20260701-1757CA	Sidi Bel Abbes	Sidi Bel Abbès	Coussin de Voyage (Couleur: Noir) x1	1.00	2026-07-06 15:58:11	2026-07-06 18:23:52	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18357313	ABN-20260702-63A9B8	Biskra	Biskra	Coussin de Voyage (Couleur: Noir) x1	1.00	2026-07-07 16:44:55	2026-07-08 13:27:43	2350.00	900	0	0	0	0	1450	Livraison
OZW-35B-18357389	ABN-20260702-15BA0B	Hassi Messaoud	Ouargla	Coussin de Voyage (Couleur: Noir) x1	1.00	2026-07-06 11:21:34	2026-07-06 19:56:16	1900.00	500	0	0	0	0	1400	LivraisonSTOP DESK
OZW-35B-18364629	ABN-20260702-54BD8D	Taleb Larbi	El Oued	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-06 13:53:41	2026-07-06 19:45:58	2500.00	1100	0	0	0	0	1400	Livraison
OZW-35B-18370891	ABN-20260703-C6496A	Ferdjioua	Mila	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-07 13:01:33	2026-07-07 14:33:53	2200.00	750	0	0	0	0	1450	Livraison
OZW-35B-18372093	ABN-20260702-D44B8C	Biskra	Biskra	Coussin de Voyage (Couleur: Noir) x1	1.00	2026-07-07 16:44:32	2026-07-08 14:21:55	1900.00	450	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18379482	ABN-20260703-0BD699	Skikda	Skikda	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-09 08:41:09	2026-07-09 11:16:49	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18473216	ABN-20260705-E21975	Bir El Djir	Oran	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-07 17:00:16	2026-07-08 10:57:39	2150.00	700	0	0	0	0	1450	Livraison
OZW-35B-18474911	ABN-20260705-BC0EFC	Khenchela	Khenchela	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-08 14:30:12	2026-07-09 09:31:39	2200.00	850	0	0	0	0	1350	Livraison
OZW-35B-18517104	ABN-20260706-A2B631	Boumerdes	Boumerdès	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-09 12:14:07	2026-07-11 11:21:02	1950.00	500	0	0	0	0	1450	Livraison
OZW-35B-18536114	ABN-20260708-0884A8	Tizi Ghenif	Tizi Ouzou	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-09 14:50:26	2026-07-09 15:02:54	2100.00	650	0	0	0	0	1450	Livraison
OZW-35B-18575517	ABN-20260709-232439	El Bayadh	El Bayadh	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-12 12:40:05	2026-07-12 19:00:44	2000.00	600	0	0	0	0	1400	LivraisonSTOP DESK
OZW-35B-18608314	ABN-20260709-0061D1	Bordj Bou Arreridj	Bordj Bou Arreridj	Coussin de Voyage (Couleur: Noir) x1	0.00	2026-07-12 16:12:41	2026-07-12 16:28:22	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18370370	ABN-20260702-949B27	El Oued	El Oued	Coussin de Voyage (Couleur: Rose Poudré) x1	0.00	2026-07-07 23:40:59	2026-07-08 14:47:38	2500.00	1100	0	0	0	0	1400	Livraison
OZW-35B-18370524	ABN-20260703-BDAE33	Mila	Mila	Coussin de Voyage (Couleur: Rose Poudré) x1	0.00	2026-07-05 11:11:23	2026-07-05 13:04:54	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18436689	ABN-20260702-9D6350	Ouled Sidi Brahim	M'Sila	Coussin de Voyage (Couleur: Rose Poudré) x1	0.00	2026-07-06 16:28:42	2026-07-07 08:56:13	2200.00	720	0	0	0	0	1480	Livraison
OZW-35B-18440841	ABN-20260705-6AB427	Maghnia	Tlemcen	Coussin de Voyage (Couleur: Rose Poudré) x1	0.00	2026-07-08 11:50:04	2026-07-08 13:17:23	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18441032	ABN-20260705-B306A2	El Achour	Alger	Coussin de Voyage (Couleur: Rose Poudré) x1	1.00	2026-07-06 14:16:23	2026-07-07 08:48:43	1900.00	450	0	0	0	0	1450	Livraison
OZW-35B-18473936	ABN-20260706-9DE01B	Kouba	Alger	Coussin de Voyage (Couleur: Rose Poudré) x1	0.00	2026-07-08 13:27:07	2026-07-09 07:57:29	1900.00	450	0	0	0	0	1450	Livraison
OZW-35B-18564250	ABN-20260708-61201D	El Milia	Jijel	Coussin de Voyage (Couleur: Rose Poudré) x1	0.00	2026-07-11 10:55:37	2026-07-11 12:06:23	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18381685	ABN-20260703-922EA5	Baraki	Alger	Coussin de Voyage (Gris ) x1 | Coussin de Voyage (Bleu ) x1	0.00	2026-07-05 11:51:06	2026-07-06 09:26:10	2900.00	450	0	0	0	0	2450	Livraison
OZW-35B-18409612	ORD-20260704-C73E02	El Bouni	Annaba	Coussin de Voyage (Gris ) x1 | Coussin de Voyage (Rose Poudré) x1	0.00	2026-07-09 17:33:24	2026-07-11 08:45:00	2800.00	350	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18451538	ABN-20260705-031443	Medea	Médéa	Coussin de Voyage (Noir) x1	1.00	2026-07-07 16:29:24	2026-07-08 10:02:30	1800.00	350	0	0	0	0	1450	LivraisonSTOP DESK
OZW-35B-18535472	ORD-20260707-9C4BA9	Ain Turk	Oran	Coussin de Voyage (Noir) x1 | Coussin de Voyage (Bordeaux) x1	0.00	2026-07-09 17:39:14	2026-07-11 10:47:12	3200.00	700	0	0	0	0	2500	Livraison
OZW-35B-18370931	ABN-20260702-562F8E	Kolea	Tipaza	Coussin de Voyage (Noir) x1 | Coussin de Voyage (Gris ) x1 | Coussin de Voyage (Bordeaux) x1 | Coussin de Voyage (Rose Poudré) x1	1.00	2026-07-08 13:54:44	2026-07-08 17:08:36	4350.00	300	0	0	0	0	4050	LivraisonSTOP DESK
OZW-35B-18386063	ABN-20260702-85FD98	Khracia	Alger	Coussin de Voyage (Noir) x1 | Coussin de Voyage (Rose Poudré) x1	0.00	2026-07-05 17:43:44	2026-07-06 11:19:21	2900.00	450	0	0	0	0	2450	Livraison
OZW-35B-18607911	ABN-20260710-CE350F	Blida	Blida	Coussin de Voyage (Noir) x1 | Coussin de Voyage (Rose Poudré) x1	0.00	2026-07-12 10:59:32	2026-07-12 14:34:28	2750.00	300	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18482475	ORD-20260706-F45D96	Hadjout	Tipaza	Coussin de Voyage (Noir) x1 | Coussin de Voyage (Rose Poudré) x1+ balance valise	1.00	2026-07-08 12:03:48	2026-07-09 10:03:53	4000.00	500	0	0	0	0	3500	Livraison
OZW-35B-18413389	ABN-20260703-C63696	Berrouaghia	Médéa	Coussin de Voyage (Noir) x2	1.00	2026-07-05 12:00:20	2026-07-06 09:56:06	3100.00	650	0	0	0	0	2450	Livraison
OZW-35B-18576412	ABN-20260709-6F080F	Ksar Chellala	Tiaret	Coussin de Voyage (Noir) x2	0.00	2026-07-12 16:56:48	2026-07-13 11:07:10	3250.00	820	0	0	0	0	2430	Livraison
OZW-35B-18373936	ABN-20260703-60382F	Mouzaia	Blida	Coussin de Voyage (Noir) x2 (rose)*1	1.00	2026-07-06 15:06:27	2026-07-07 09:11:27	2950.00	500	0	0	0	0	2450	Livraison
OZW-35B-18325739	ORD-20260629-81B7FC	Sig	Mascara	Coussin de Voyage (Noir) x2 | Coussin de Voyage (Gris ) x1 | Coussin de Voyage (Bordeaux) x1	0.00	2026-07-04 12:33:30	2026-07-05 09:03:29	5200.00	720	0	0	0	0	4480	Livraison
OZW-35B-18473824	ABN-20260705-94A0DE	Tadjenanet	Mila	Coussin de Voyage (Noir) x4 | Coussin de Voyage (Bleu ) x1 | Coussin de Voyage (Gris ) x1 | Coussin de Voyage (Rose Poudré) x1	0.00	2026-07-07 15:27:18	2026-07-08 09:12:45	7800.00	750	0	0	0	0	7050	Livraison
OZW-35B-18564446	ABN-20260708-5017DE	Zeribet El Oued	Biskra	Coussin de Voyage (P1: Couleur: Bleu | P2: Couleur: Bleu | P3: Couleur: Bleu ) x3	0.00	2026-07-11 19:57:18	2026-07-12 12:24:38	4451.00	900	0	0	0	0	3551	Livraison
OZW-35B-18473193	ABN-20260705-714BAC	Guelma	Guelma	Coussin de Voyage (P1: Couleur: Bleu | P2: Couleur: Rose Poudré | P3: Couleur: Gris ) x3	0.00	2026-07-07 15:22:13	2026-07-08 10:13:00	4351.00	820	0	0	0	0	3531	Livraison
OZW-35B-18372717	ABN-20260703-2F3F2A	Mohammadia	Alger	Coussin de Voyage (P1: Couleur: Bleu | P2: Couleur: Rose Poudré) x2	0.00	2026-07-06 18:13:14	2026-07-07 09:33:26	2900.00	450	0	0	0	0	2450	Livraison
OZW-35B-18392686	ABN-20260703-D2A8E8	Bougara	Blida	Coussin de Voyage (P1: Couleur: Bordeaux | P2: Couleur: Bleu ) x2	0.00	2026-07-05 11:18:59	2026-07-06 08:49:47	2950.00	500	0	0	0	0	2450	Livraison
OZW-35B-18569656	ABN-20260709-354AF3	Constantine	Constantine	Coussin de Voyage (P1: Couleur: Bordeaux | P2: Couleur: Rose Poudré | P3: Couleur: Gris ) x3	0.00	2026-07-11 10:49:00	2026-07-11 15:29:00	3901.00	350	0	0	0	0	3551	LivraisonSTOP DESK
OZW-35B-18473237	ABN-20260705-4730D1	Oued El Djemaa	Relizane	Coussin de Voyage (P1: Couleur: Gris | P2: Couleur: Bleu ) x2	0.00	2026-07-07 18:52:08	2026-07-08 10:53:39	3200.00	720	0	0	0	0	2480	Livraison
OZW-35B-18392593	ABN-20260703-890782	Birtouta	Alger	Coussin de Voyage (P1: Couleur: Gris | P2: Couleur: Noir) x2	0.00	2026-07-07 13:58:12	2026-07-08 09:05:52	2900.00	450	0	0	0	0	2450	Livraison
OZW-35B-18507615	ABN-20260706-FF77E6	Mostaganem	Mostaganem	Coussin de Voyage (P1: Couleur: Noir | P2: Couleur: Bordeaux | P3: Couleur: Bleu ) x3	0.00	2026-07-12 14:45:54	2026-07-12 16:20:29	3901.00	350	0	0	0	0	3551	LivraisonSTOP DESK
OZW-35B-18354775	ABN-20260701-5EF879	Annaba	Annaba	Coussin de Voyage (P1: Couleur: Noir | P2: Couleur: Bordeaux) x2	0.00	2026-07-05 13:59:11	2026-07-05 14:23:21	2800.00	350	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18346703	ABN-20260701-F27C9F	Ain Taya	Alger	Coussin de Voyage (P1: Couleur: Noir | P2: Couleur: Gris | P3: Couleur: Bleu x3	1.00	2026-07-05 15:37:00	2026-07-06 10:27:40	4001.00	450	0	0	0	0	3551	Livraison
OZW-35B-18564347	ABN-20260708-E4E009	Oum El Bouaghi	Oum El Bouaghi	Coussin de Voyage (P1: Couleur: Noir | P2: Couleur: Gris | P3: Couleur: Noir) x3	0.00	2026-07-11 17:34:44	2026-07-11 17:51:24	3901.00	350	0	0	0	0	3551	LivraisonSTOP DESK
OZW-35B-18413653	ABN-20260702-8CC2D4	Guelma	Guelma	Coussin de Voyage (P1: Couleur: Noir | P2: Couleur: Gris ) x2	0.00	2026-07-09 13:38:16	2026-07-09 16:02:00	2800.00	350	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18355284	ABN-20260701-7D370C	Medea	Médéa	Coussin de Voyage (P1: Couleur: Noir | P2: Couleur: Noir | P3: Couleur: Noir | p4: couleur: Noir) 4	1.00	2026-07-07 16:11:55	2026-07-08 10:02:30	4800.00	350	0	0	0	0	4450	LivraisonSTOP DESK
OZW-35B-18355424	ABN-20260701-F6F164	Soumaa	Blida	Coussin de Voyage (P1: Couleur: Noir | P2: Couleur: Noir) x2	0.00	2026-07-05 20:34:17	2026-07-06 10:35:54	2950.00	500	0	0	0	0	2450	Livraison
OZW-35B-18370383	ABN-20260702-4B0CEB	Hussein Dey	Alger	Coussin de Voyage (P1: Couleur: Noir | P2: Couleur: Noir) x2	1.00	2026-07-05 13:13:57	2026-07-07 09:41:55	2900.00	450	0	0	0	0	2450	Livraison
OZW-35B-18473853	ABN-20260706-B18BA0	Chlef	Chlef	Coussin de Voyage (P1: Couleur: Noir | P2: Couleur: Noir) x2	0.00	2026-07-11 12:02:15	2026-07-11 12:27:22	2800.00	350	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18504771	ABN-20260706-8CCEFE	Mostaganem	Mostaganem	Coussin de Voyage (P1: Couleur: Noir | P2: Couleur: Rose Poudré) x2	0.00	2026-07-09 13:55:32	2026-07-09 15:00:07	2800.00	350	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18505264	ABN-20260707-ADAAF2	Blida	Blida	Coussin de Voyage (P1: Couleur: Rose Poudré | P2: Couleur: Bleu | P3: Couleur: Noir) x3	0.00	2026-07-09 10:31:24	2026-07-11 09:41:09	4051.00	500	0	0	0	0	3551	Livraison
OZW-35B-18355397	ABN-20260701-BF878B	Baba Hassen	Alger	Coussin de Voyage (P1: Couleur: Rose Poudré | P2: Couleur: Bleu ) x2	0.00	2026-07-06 15:29:59	2026-07-07 10:53:58	2900.00	450	0	0	0	0	2450	Livraison
OZW-35B-18475019	ABN-20260705-1C211F	Hassi Messaoud	Ouargla	Coussin de Voyage (P1: Couleur: Rose Poudré | P2: Couleur: Bleu ) x2	1.00	2026-07-09 11:16:06	2026-07-09 13:30:43	2900.00	500	0	0	0	0	2400	LivraisonSTOP DESK
OZW-35B-18364841	ABN-20260702-86E640	Arzew	Oran	Coussin de Voyage (P1: Couleur: Rose Poudré | P2: Couleur: Bordeaux) x2	0.00	2026-07-06 16:12:56	2026-07-06 16:47:15	2800.00	350	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18535103	ABN-20260707-7A58F4	Mechroha	Souk Ahras	Coussin de Voyage (P1: Couleur: Rose Poudré | P2: Couleur: Gris | P3: Couleur: Noir) x3	0.00	2026-07-09 16:16:19	2026-07-11 10:07:36	4401.00	850	0	0	0	0	3551	Livraison
OZW-35B-18352729	ABN-20260701-190A26	Mila	Mila	Coussin de Voyage (P1: Couleur: Rose Poudré | P2: Couleur: Noir) x2	0.00	2026-07-06 11:38:00	2026-07-06 14:52:57	2800.00	350	0	0	0	0	2450	LivraisonSTOP DESK
OZW-35B-18385793	ABN-20260701-58CB24	Douera	Alger	Coussin de Voyage (Rose Poudré) x1 | Coussin de Voyage (Bleu ) x1 | Coussin de Voyage (Gris ) x1 | Coussin de Voyage (Noir) x1	0.00	2026-07-06 13:32:00	2026-07-07 11:38:26	4700.00	450	0	0	0	0	4250	Livraison
OZW-35B-18330946	5383929	Khracia	Alger	Coussin gris	1.00	2026-07-01 11:29:13	2026-07-01 13:33:07	1900.00	450	0	0	0	0	1450	Livraison
OZW-35B-18478491	5383829	Mouzaia	Blida	Coussin gris	1.00	2026-07-07 14:52:41	2026-07-08 09:05:39	1200.00	500	0	0	0	0	700	Livraison
OZW-35B-18298601	ORD-20260629-7B7138	Oran	Oran	Coussin noir	1.00	2026-06-30 13:38:29	2026-07-01 10:29:46	2200.00	700	0	0	0	0	1500	Livraison
OZW-35B-18284159	246789	Tindouf	Tindouf	Coussin noir et bleu	1.00	2026-07-06 11:59:51	2026-07-06 13:12:21	3000.00	600	0	0	0	0	2400	LivraisonSTOP DESK
OZW-35B-18413145	537282929	Hydra	Alger	Rangement de valise 6pcs	1.00	2026-07-05 16:40:21	2026-07-06 10:30:14	1700.00	450	0	0	0	0	1250	Livraison
OZW-35B-18482031	35789	Medea	Médéa	Rangement valise 6pcs	1.00	2026-07-09 11:47:44	2026-07-09 11:59:28	1500.00	350	0	0	0	0	1150	LivraisonSTOP DESK
"""

items = []
seen = set()
for l in raw_data.strip().split("\n"):
    if not l.strip(): continue
    parts = l.strip().split("\t")
    if len(parts) >= 2:
        tracking = parts[0].strip()
        ref = parts[1].strip()
        delivered_date = None
        for p in parts:
            if re.match(r"^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$", p.strip()):
                delivered_date = p.strip()
        key = (tracking, ref)
        if key not in seen:
            seen.add(key)
            items.append({"tracking": tracking, "ref": ref, "delivered_at": delivered_date})

sql_lines = [
    "-- ===========================================================================",
    "-- 🚚 SCRIPT DE MISE À JOUR DES COMMANDES LIVRÉES (STATUT 'DELIVERED')",
    "-- Note : Ce script conserve à 100% les dates de création d'origine (created_at).",
    "-- ===========================================================================",
    ""
]

for it in items:
    tracking = it["tracking"]
    ref = it["ref"]
    d_at = it["delivered_at"] or "2026-08-17 12:00:00"
    
    clause_where = []
    if ref and ref.lower() != "null":
        clause_where.append(f"order_number = '{ref}'")
    if tracking:
        clause_where.append(f"tracking_number = '{tracking}'")
        clause_where.append(f"order_number = '{tracking}'")
    
    where_str = " OR ".join(clause_where)
    sql_lines.append(f"UPDATE orders SET status = 'DELIVERED', is_deleted = FALSE, tracking_number = '{tracking}', updated_at = TIMESTAMP '{d_at}' WHERE {where_str};")

with open("app/db/migrations/update_delivered_orders.sql", "w", encoding="utf-8") as f:
    f.write("\n".join(sql_lines))

print(f"Generated updated SQL script with {len(items)} unique update statements!")
