import MaterialsUploader from "../../components/MaterialsUploader";
import MaterialsTable from "../../components/MaterialsTable";

export default function MaterialsPage() {
  return (
    <main className="min-h-screen w-full overflow-x-hidden bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto w-full max-w-[960px] min-w-0 px-4 py-8 sm:px-6">
        <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-slate-100">
          教材管理（ Qdrant 資料庫管理 ）
        </h1>

        <div className="grid w-full min-w-0 gap-6">
          <MaterialsUploader />
          <MaterialsTable />
        </div>
      </div>
    </main>
  );
}