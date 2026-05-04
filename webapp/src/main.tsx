import { render } from 'preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { initI18n } from './lib/i18n';
import './tailwind.css';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

const root = document.getElementById('root')!;

function renderApp(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
    root
  );
}

renderApp();

void initI18n().then(() => {
  renderApp();
});
