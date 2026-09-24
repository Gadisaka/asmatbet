function PageContainer({ children }) {
  return (
    <div className="min-h-screen w-full max-w-full overflow-x-clip bg-transparent text-(--sb-text)">
      {children}
    </div>
  );
}

export default PageContainer;
