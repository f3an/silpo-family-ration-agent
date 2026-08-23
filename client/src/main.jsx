import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { store } from './app/store';
import { ModalProvider } from './context/ModalContext';
import App from './App.jsx';
import './style.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Provider store={store}>
      <BrowserRouter>
        <ModalProvider>
          <App />
        </ModalProvider>
      </BrowserRouter>
    </Provider>
  </StrictMode>,
);
