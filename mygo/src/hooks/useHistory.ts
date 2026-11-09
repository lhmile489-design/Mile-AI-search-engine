
import { useCallback, useEffect, useState } from "react";
import { deleteHistory, getHistoryList } from "@/lib/api";
import type { HistoryCard } from "@/types";

// 历史列表。version 变化（done 事件、删除）时重新拉取。前端不在浏览器本地另存历史。

export type HistoryState = Readonly<{
  records: ReadonlyArray<HistoryCard>;
  total: number;
  loading: boolean;
  failed: boolean;
  remove: (id: string) => Promise<boolean>;
}>;

export function useHistory(version: number): HistoryState {
  const [records, setRecords] = useState<ReadonlyArray<HistoryCard>>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    getHistoryList(1, 50, controller.signal)
      .then((data) => {
        setRecords(data.records);
        setTotal(data.total);
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [version]);

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try {
      await deleteHistory(id);
      setRecords((prev) => prev.filter((item) => item.id !== id));
      setTotal((prev) => Math.max(0, prev - 1));
      return true;
    } catch {
      return false;
    }
  }, []);

  return { records, total, loading, failed, remove };
}
