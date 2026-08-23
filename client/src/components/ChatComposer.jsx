import { useEffect, useRef, useState } from 'react';
import { useModals } from '../context/ModalContext';

/** Structured so a second action just means one more entry here — the
 * search box below filters on `title`, so it stays meaningful once there's
 * more than one. */
function useMenuItems() {
  const { openPlanForm, openDishForm, openOccasionForm } = useModals();
  return [
    {
      id: 'plan',
      icon: '📝',
      title: 'Скласти раціон',
      hint: 'Форма замість вільного тексту',
      onSelect: openPlanForm,
    },
    {
      id: 'dish',
      icon: '🍲',
      title: 'Скласти страву',
      hint: 'Інгредієнти для однієї страви',
      onSelect: openDishForm,
    },
    {
      id: 'occasion',
      icon: '🎉',
      title: 'Набір під подію',
      hint: 'Курована підбірка товарів',
      onSelect: openOccasionForm,
    },
    // Ідеї для наступних візардів — уже видимі в меню з плашкою
    // "Незабаром", але без реалізації (onSelect відсутній, пункт
    // неактивний — див. рендер нижче).
    {
      id: 'order-stats',
      icon: '📊',
      title: 'Статистика замовлень',
      hint: 'Аналіз витрат і топ-покупок',
      comingSoon: true,
    },
    {
      id: 'favorites-cart',
      icon: '🔁',
      title: 'Повторити улюблене',
      hint: 'Кошик з улюблених товарів',
      comingSoon: true,
    },
    {
      id: 'deals-cart',
      icon: '🏷️',
      title: 'Кошик знижок',
      hint: 'Підбірка товарів на знижках',
      comingSoon: true,
    },
  ];
}

export default function ChatComposer({ draft, onDraftChange, onSubmit, isSending, large }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const formRef = useRef(null);
  const items = useMenuItems();

  useEffect(() => {
    if (!isMenuOpen) return undefined;

    function handlePointerDown(e) {
      if (formRef.current && !formRef.current.contains(e.target)) setIsMenuOpen(false);
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') setIsMenuOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

  function closeMenu() {
    setIsMenuOpen(false);
    setQuery('');
  }

  const filteredItems = items.filter((item) => item.title.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <form className={`chat-composer${large ? ' chat-composer-large' : ''}`} onSubmit={onSubmit} ref={formRef}>
      <button
        type="button"
        className="chat-composer-plus"
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        aria-label="Дії"
        onClick={() => (isMenuOpen ? closeMenu() : setIsMenuOpen(true))}
      >
        +
      </button>

      <input
        className="chat-input"
        type="text"
        placeholder="Напиши повідомлення..."
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        disabled={isSending}
      />
      <button className="primary-btn" type="submit" disabled={isSending || !draft.trim()}>
        Надіслати
      </button>

      {isMenuOpen && (
        <div className="chat-composer-menu">
          {filteredItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`chat-composer-menu-item${item.comingSoon ? ' disabled' : ''}`}
              aria-disabled={item.comingSoon || undefined}
              onClick={() => {
                if (item.comingSoon) return;
                closeMenu();
                item.onSelect();
              }}
            >
              <span>
                {item.icon} {item.title}
              </span>
              <span className="chat-composer-menu-hint-row">
                <span className="chat-composer-menu-hint">{item.hint}</span>
                {item.comingSoon && <span className="chat-composer-menu-badge">Незабаром</span>}
              </span>
            </button>
          ))}
          {filteredItems.length === 0 && <p className="chat-composer-menu-empty">Нічого не знайдено</p>}
          <input
            className="chat-composer-menu-search"
            type="text"
            placeholder="Пошук дій..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
      )}
    </form>
  );
}
