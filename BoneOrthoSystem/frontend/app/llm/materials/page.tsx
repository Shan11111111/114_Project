import MaterialsUploader from "../../components/MaterialsUploader";
import MaterialsTable from "../../components/MaterialsTable";

export default function MaterialsPage() {
  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
        教材管理（RAG）
      </h1>

      <div style={{ display: "grid", gap: 16 }}>
        <MaterialsUploader />
        <MaterialsTable />
      </div>
    </div>
  );
}
