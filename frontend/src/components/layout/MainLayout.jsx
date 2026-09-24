function MainLayout({ left, center, right }) {
  return (
    <div className="grid w-full min-w-0 max-w-full items-start gap-2.5 overflow-x-clip px-2 pb-2 pt-1 sm:px-3 max-lg:grid-cols-1 lg:grid-cols-[minmax(0,11.5rem)_minmax(0,1fr)_minmax(0,16rem)] xl:grid-cols-[minmax(0,13.5rem)_minmax(0,1fr)_minmax(0,17.5rem)]">
      <aside className="hidden min-w-0 max-w-full flex-col gap-2 overflow-hidden rounded-[1.35rem] shadow-[0_16px_40px_-20px_rgba(0,0,0,0.5)] backdrop-blur-sm lg:sticky lg:top-[var(--sb-sticky-header)] lg:flex lg:min-h-0 lg:max-h-[calc(100vh-var(--sb-sticky-header))]">
        {left}
      </aside>
      <div className="flex min-w-0 max-w-full flex-col gap-2 overflow-x-hidden rounded-[1.35rem] shadow-[0_20px_50px_-18px_rgba(0,0,0,0.55)] backdrop-blur-sm max-lg:order-1">
        {center}
      </div>
      <aside className="hidden min-w-0 max-w-full overflow-x-hidden overflow-y-auto rounded-[1.35rem] shadow-[0_16px_40px_-20px_rgba(0,0,0,0.5)] backdrop-blur-sm lg:sticky lg:top-[var(--sb-sticky-header)] lg:block lg:max-h-[calc(100vh-var(--sb-sticky-header))]">
        {right}
      </aside>
    </div>
  );
}

export default MainLayout;
