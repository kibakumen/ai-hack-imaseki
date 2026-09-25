-- 承認されないまま置かれた営業許可書の保管期限（2026-09-26 の最終の手直し・安全-20 の案1 の残り・AI判断）。
--
-- 上げてから30日たっても承認されない店の許可書は、審査が終わったものとして消す（usecases/licenseSweep）。数える起点は
-- 上げた時刻 stores.license_uploaded_at（migration 0011 で足した列）だが、0011 より前に上げた許可書はこの列が空で、
-- 期限の数えに入らない。そこで、今ある「承認されていない店の許可書」は、この migration を当てた時刻を上げた時刻として埋める
-- （本当の時刻は分からない。空のままにすると期限なく残るので、当てた時点から30日を数える）。承認済みの店には触れない。
UPDATE stores
   SET license_uploaded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE status <> 'approved'
   AND license_key IS NOT NULL
   AND license_uploaded_at IS NULL;
