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

async function bootstrap(): Promise<void> {
  await initI18n();
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
    document.getElementById('root')!
  );
}

void bootstrap();
