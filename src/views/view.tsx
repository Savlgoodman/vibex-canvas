type Environment = {
  invoke: (
    method: string,
    input?: Record<string, unknown> | null
  ) => Promise<unknown>;
};

type SidecarStatus = { state?: string; origin?: string; lastError?: string };
type SidecarMessage = { type?: string; id?: string; method?: string; input?: Record<string, unknown> | null };

function showStatus(root: HTMLElement, title: string, detail: string) {
  root.replaceChildren();
  const section = document.createElement('section');
  section.style.cssText = 'box-sizing:border-box;height:100%;padding:16px;color:inherit';
  const heading = document.createElement('strong');
  heading.textContent = title;
  const paragraph = document.createElement('p');
  paragraph.textContent = detail;
  paragraph.style.opacity = '0.7';
  section.append(heading, paragraph);
  root.append(section);
}

export function mount(root: HTMLElement, environment?: Environment) {
  let cancelled = false;
  let frame: HTMLIFrameElement | undefined;
  let timer: number | undefined;
  const onMessage = (event: MessageEvent<SidecarMessage>) => {
    if (!frame || event.source !== frame.contentWindow) return;
    const message = event.data;
    if (message?.type !== 'vibex-sidecar-invoke' || !message.id || !message.method) return;
    void environment?.invoke(message.method, message.input ?? null).then(
      (result) => frame?.contentWindow?.postMessage({ type: 'vibex-sidecar-result', id: message.id, result }, '*'),
      (error) => frame?.contentWindow?.postMessage({
        type: 'vibex-sidecar-result',
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      }, '*'),
    );
  };
  const paint = async () => {
    if (cancelled || !environment) return;
    try {
      const status = (await environment.invoke('runtime.status')) as SidecarStatus;
      if (cancelled) return;
      if (status?.state === 'running' && status.origin) {
        frame = document.createElement('iframe');
        frame.setAttribute('aria-label', '生图画板');
        frame.src = `${status.origin.replace(/\/$/, '')}/`;
        frame.style.cssText = 'border:0;width:100%;height:100%;display:block;background:transparent;';
        root.replaceChildren(frame);
        window.addEventListener('message', onMessage);
        return;
      }
      showStatus(root, status?.state === 'starting' ? '正在启动生图画板' : '生图画板未就绪', status?.lastError || '正在等待本地 sidecar。');
    } catch (error) {
      showStatus(root, '生图画板未就绪', error instanceof Error ? error.message : String(error));
    }
  };
  void paint();
  timer = window.setInterval(() => { if (!frame) void paint(); }, 1500);
  return () => {
    cancelled = true;
    if (timer !== undefined) window.clearInterval(timer);
    window.removeEventListener('message', onMessage);
    root.replaceChildren();
    frame = undefined;
  };
}
