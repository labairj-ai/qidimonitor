import React, { createContext, useContext, useMemo } from 'react';
export const PrinterContext = createContext('qidi');
export function usePrinterApi() {
  const id = useContext(PrinterContext);
  return useMemo(() => {
    const apiUrl = url => url.replace(/^\/api(?=\/|$)/, `/api/printers/${encodeURIComponent(id)}`);
    return { apiUrl, apiFetch: (url, options) => fetch(apiUrl(url), options) };
  }, [id]);
}
