import { useEffect } from 'react';

const SCRIPT_SRC = 'https://cdn.inspectr.dev/script.js';
const SCRIPT_ID = 'cdn-stats';
const DATA_DOMAIN = 'mcplab.inspectr.dev';

export function CdnStats() {
  useEffect(() => {
    if (document.getElementById(SCRIPT_ID)) return;

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.defer = true;
    script.src = SCRIPT_SRC;
    script.setAttribute('data-domain', DATA_DOMAIN);
    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, []);

  return null;
}

export default CdnStats;
