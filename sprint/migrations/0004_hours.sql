-- デモの時間帯に合わせて受付時間を広げる（まる・福来・一途は朝から。ソレイユのランチ枠は「受付時間の外」の例として残す）
UPDATE s_offers SET start_min = 540, end_min = 1380 WHERE store_id = 'st-maru';
UPDATE s_offers SET start_min = 540, end_min = 1320 WHERE store_id = 'st-fukurai';
UPDATE s_offers SET start_min = 540, end_min = 1380 WHERE store_id = 'st-ichizu';
UPDATE s_offers SET start_min = 1020, end_min = 1320 WHERE id = 'st-soleil-o2';
