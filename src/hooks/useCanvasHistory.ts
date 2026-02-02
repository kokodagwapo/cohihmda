/**
 * Undo/redo history for canvas state (layout items + annotations).
 * Snapshots are taken before mutations; undo/redo restore previous state.
 */

import { useState, useCallback, useRef } from 'react';

export interface CanvasSnapshot<TItem = unknown, TAnn = unknown> {
  items: TItem[];
  annotations: TAnn[];
}

const MAX_HISTORY = 50;

export function useCanvasHistory<TItem = unknown, TAnn = unknown>(
  initialItems: TItem[] = [],
  initialAnnotations: TAnn[] = []
) {
  const [items, setItems] = useState<TItem[]>(initialItems);
  const [annotations, setAnnotations] = useState<TAnn[]>(initialAnnotations);
  const [historyLength, setHistoryLength] = useState(0);
  const [futureLength, setFutureLength] = useState(0);
  const historyRef = useRef<CanvasSnapshot<TItem, TAnn>[]>([]);
  const futureRef = useRef<CanvasSnapshot<TItem, TAnn>[]>([]);

  const pushSnapshot = useCallback(() => {
    const snapshot: CanvasSnapshot<TItem, TAnn> = {
      items: JSON.parse(JSON.stringify(items)),
      annotations: JSON.parse(JSON.stringify(annotations)),
    };
    historyRef.current = [...historyRef.current.slice(-(MAX_HISTORY - 1)), snapshot];
    futureRef.current = [];
    setHistoryLength(historyRef.current.length);
    setFutureLength(0);
  }, [items, annotations]);

  const setItemsWithHistory = useCallback(
    (updater: (prev: TItem[]) => TItem[]) => {
      pushSnapshot();
      setItems(updater);
    },
    [pushSnapshot]
  );

  const setAnnotationsWithHistory = useCallback(
    (updater: (prev: TAnn[]) => TAnn[]) => {
      pushSnapshot();
      setAnnotations(updater);
    },
    [pushSnapshot]
  );

  const setBothWithHistory = useCallback(
    (nextItems: TItem[], nextAnnotations: TAnn[]) => {
      pushSnapshot();
      setItems(nextItems);
      setAnnotations(nextAnnotations);
    },
    [pushSnapshot]
  );

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (!prev) return false;
    futureRef.current = [
      ...futureRef.current,
      { items: JSON.parse(JSON.stringify(items)), annotations: JSON.parse(JSON.stringify(annotations)) },
    ];
    setItems(prev.items);
    setAnnotations(prev.annotations);
    setHistoryLength(historyRef.current.length);
    setFutureLength(futureRef.current.length);
    return true;
  }, [items, annotations]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return false;
    historyRef.current = [
      ...historyRef.current,
      { items: JSON.parse(JSON.stringify(items)), annotations: JSON.parse(JSON.stringify(annotations)) },
    ];
    setItems(next.items);
    setAnnotations(next.annotations);
    setHistoryLength(historyRef.current.length);
    setFutureLength(futureRef.current.length);
    return true;
  }, [items, annotations]);

  return {
    items,
    annotations,
    setItems,
    setAnnotations,
    setItemsWithHistory,
    setAnnotationsWithHistory,
    setBothWithHistory,
    pushSnapshot,
    undo,
    redo,
    canUndo: historyLength > 0,
    canRedo: futureLength > 0,
  };
}
