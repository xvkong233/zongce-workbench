import sys
sys.path.insert(0, ".")
from app.database import SessionLocal
from app.models import ImportBatch, EvalRecord
with SessionLocal() as db:
    for b in db.query(ImportBatch).all():
        snap = b.snapshot or []
        print(f"batch#{b.id} kind={b.kind} snapshot_len={len(snap)} "
              f"first={ {k: snap[0][k] for k in list(snap[0])[:3]} if snap else None }")
    from collections import Counter
    print("eval batch_id 分布:", Counter(r.batch_id for r in db.query(EvalRecord).all()))
