// Shown when the graph pauses in `interrupt()` (the human-in-the-loop stock purchase).
export default function ApprovalCard({ message, onDecision }) {
  return (
    <div className="approval" role="alertdialog" aria-label="Approval required">
      <div className="approval-title">✋ Approval required</div>
      <p>{message}</p>
      <div className="approval-actions">
        <button className="btn-primary" onClick={() => onDecision("yes")}>
          Approve
        </button>
        <button className="btn-secondary" onClick={() => onDecision("no")}>
          Reject
        </button>
      </div>
    </div>
  );
}
