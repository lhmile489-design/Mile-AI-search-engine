import { useCallback, useRef, useState } from "react";
import type { SearchAction } from "./actions";
import { initialState, type SearchState } from "./state";
import { searchReducer } from "./reducer";

// 对 reducer 的薄封装：dispatch 同步算出下一个状态并写入 ref，
// 这样调用方在 dispatch(SUBMIT) 之后能立即读到新的 runId，用来给流事件打标。
// reducer 本身仍是纯函数，单测直接调用它。

export type SearchStore = Readonly<{
  state: SearchState;
  dispatch: (action: SearchAction) => void;
  getState: () => SearchState;
}>;

export function useSearchStore(): SearchStore {
  const [state, setState] = useState<SearchState>(initialState);
  const ref = useRef<SearchState>(initialState);

  const dispatch = useCallback((action: SearchAction) => {
    const next = searchReducer(ref.current, action);
    if (next === ref.current) return;
    ref.current = next;
    setState(next);
  }, []);

  const getState = useCallback(() => ref.current, []);
  return { state, dispatch, getState };
}
