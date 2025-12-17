import { useState, useEffect, useMemo } from "react";
import Modal from "./Modal";
import { getFixedStakes, parseLegacyStakes } from "../utils/poker";
import type { BalanceDoc, GroupDoc } from "../types/poker";

type Props = {
  open: boolean;
  onClose: () => void;
  // If balance is provided, we are in "Edit" mode.
  // If null, we are in "Create" (Report) mode.
  balance: BalanceDoc | null;
  group: GroupDoc | null;
  // Pre-filled date for Create mode, optional
  defaultDate?: string;
  // Pre-filled stakes for Create mode, optional
  defaultStakes?: { sb: string; bb: string };
  
  onSave: (data: {
    date: string;
    sb: number;
    bb: number;
    buyIn: number;
    ending: number;
    memo: string;
  }) => Promise<void>;
  
  // Delete action is only available in Edit mode
  onDeleteRequest?: () => void;
};

export default function BalanceFormModal({
  open,
  onClose,
  balance,
  group,
  defaultDate,
  defaultStakes,
  onSave,
  onDeleteRequest,
}: Props) {
  const isEdit = !!balance;
  const title = isEdit ? "収支を編集" : "収支を報告";
  const saveLabel = isEdit ? "保存する" : "報告する";
  const savingLabel = isEdit ? "保存中..." : "送信中...";

  const [date, setDate] = useState("");
  const [sb, setSb] = useState("");
  const [bb, setBb] = useState("");
  const [buyIn, setBuyIn] = useState("");
  const [ending, setEnding] = useState("");
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);

  // Stabilize fixed stakes object to prevent unwanted effect re-runs
  const fixed = useMemo(() => getFixedStakes(group), [group]);

  // Memoize legacy stakes parsing for the same reason if balance exists
  const legacyStakes = useMemo(() => {
    if (balance && !fixed) {
      return parseLegacyStakes(balance.stakes);
    }
    return null;
  }, [balance, fixed]);

  // Initialize state
  useEffect(() => {
    if (open) {
      if (balance) {
        // Edit Mode
        setDate(balance.date || "");
        setBuyIn(String(balance.buy_in_bb));
        setEnding(String(balance.ending_bb));
        setMemo(balance.memo || "");

        if (fixed) {
          setSb(String(fixed.sb));
          setBb(String(fixed.bb));
        } else if (legacyStakes) {
          setSb(legacyStakes.sb ? String(legacyStakes.sb) : "");
          setBb(legacyStakes.bb ? String(legacyStakes.bb) : "");
        }
      } else {
        // Create Mode
        // Only set defaults if state is empty? 
        // Actually, we want to reset to defaults whenever modal opens fresh.
        // But if 'open' stays true and we type, this effect should NOT run.
        // The issue was 'fixed' changing identity on every render.
        
        setDate(defaultDate || new Date().toISOString().slice(0, 10));
        setBuyIn("");
        setEnding("");
        setMemo("");
        
        if (fixed) {
          setSb(String(fixed.sb));
          setBb(String(fixed.bb));
        } else if (defaultStakes) {
          setSb(defaultStakes.sb);
          setBb(defaultStakes.bb);
        } else {
          setSb("");
          setBb("");
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, balance]); 
  // Removed 'fixed', 'defaultDate', 'defaultStakes' from dependency array 
  // because we only want to initialize when the modal *opens* or the target *balance* changes.
  // We trust 'open' and 'balance' identity changes to trigger reset.
  // 'fixed' is stable now thanks to useMemo, but logic-wise we only need to load it on open.

  const handleSave = async () => {
    const sVal = Number(sb);
    const bVal = Number(bb);
    if (!date || isNaN(sVal) || isNaN(bVal)) {
      alert("日付 / SB / BB を正しく入力してください");
      return;
    }
    if (sVal <= 0 || bVal <= 0) {
      alert("SB と BB は 0 より大きい数値にしてください");
      return;
    }
    const buyInVal = Number(buyIn);
    const endingVal = Number(ending);
    if (isNaN(buyInVal) || isNaN(endingVal)) {
      alert("バイイン / 終了時スタック を正しく入力してください");
      return;
    }

    setSaving(true);
    try {
      await onSave({
        date,
        sb: sVal,
        bb: bVal,
        buyIn: buyInVal,
        ending: endingVal,
        memo,
      });
      // Do NOT close automatically here; usually parent handles it or we close on success.
      // But preserving existing behavior:
      // In Edit Modal it closed. In Report it closed.
      // We'll let the parent close it if successful, OR close here?
      // The Logic extracted from BalanceEditModal closed it.
      // Logic extracted from PlayerGroupPage Report didn't explicitely close inside the UI logic, but logic did.
      // For safety, let's close here IF no error thrown.
      // Actually onSave in PlayerGroupPage throws on error for Edit, catches for Report.
      // Let's standardise: Caller closes on success.
      // WAIT, existing BalanceEditModal calls onClose().
      // Let's keep calling onClose() here.
      onClose();
    } catch (e) {
      console.error(e);
      alert(`${isEdit ? "保存" : "登録"}に失敗しました`);
    } finally {
      setSaving(false);
    }
  };

  const inp: React.CSSProperties = {
    width: "100%",
    padding: 10,
    borderRadius: 8,
    border: "1px solid #ddd",
    boxSizing: "border-box",
  };

  const lbl: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 700,
    display: "block",
    marginBottom: 4,
  };

  return (
    <Modal open={open} onClose={onClose} width={400}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <div style={{ display: "grid", gap: 12 }}>
        <div>
          <label style={lbl}>日付</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={inp}
          />
        </div>
        <div>
          <label style={lbl}>ステークス (SB / BB)</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="number"
              placeholder="SB"
              value={sb}
              onChange={(e) => setSb(e.target.value)}
              disabled={!!fixed}
              style={{
                ...inp,
                flex: 1,
                background: fixed ? "#f4f4f7" : "#fff",
              }}
            />
            <input
              type="number"
              placeholder="BB"
              value={bb}
              onChange={(e) => setBb(e.target.value)}
              disabled={!!fixed}
              style={{
                ...inp,
                flex: 1,
                background: fixed ? "#f4f4f7" : "#fff",
              }}
            />
          </div>
        </div>
        <div>
          <label style={lbl}>バイイン (BB)</label>
          <input
            type="number"
            placeholder="例: 100"
            value={buyIn}
            onChange={(e) => setBuyIn(e.target.value)}
            style={inp}
          />
        </div>
        <div>
          <label style={lbl}>終了時スタック (BB)</label>
          <input
            type="number"
            placeholder="例: 150"
            value={ending}
            onChange={(e) => setEnding(e.target.value)}
            style={inp}
          />
        </div>
        <div>
          <label style={lbl}>メモ {isEdit ? "" : "(任意)"}</label>
          <input
            placeholder="場所や状況など"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            style={inp}
          />
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          {isEdit && onDeleteRequest && (
            <button
              onClick={onDeleteRequest}
              style={{
                flex: 1,
                padding: 12,
                borderRadius: 8,
                background: "#fee",
                color: "#d00",
                fontWeight: 700,
                cursor: "pointer",
                border: "none",
              }}
            >
              削除...
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              flex: 2,
              padding: 12,
              borderRadius: 8,
              background: "#111",
              color: "#fff",
              fontWeight: 700,
              cursor: "pointer",
              border: "none",
            }}
          >
            {saving ? savingLabel : saveLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
