'use client';

import React, { useState, useEffect } from 'react';

export type UiTheme = 'glass' | 'dashboard' | 'industrial';

interface ThemeOption {
  id: UiTheme;
  title: string;
  badge: string;
  desc: string;
  color: string;
  previewBorder: string;
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'glass',
    title: '💎 Sleek Glassmorphism',
    badge: 'Khuyên dùng',
    desc: 'Kính mờ Linear/Vercel, nền đen sâu, viền phản quang phát sáng nhẹ.',
    color: '#3b82f6',
    previewBorder: '1px solid rgba(59, 130, 246, 0.4)',
  },
  {
    id: 'dashboard',
    title: '📊 Full-Width SaaS Dashboard',
    badge: 'Tối ưu PC/Laptop',
    desc: 'Mở rộng toàn màn hình máy tính (1200px), thẻ gọn gàng phong cách ERP.',
    color: '#6366f1',
    previewBorder: '1px solid rgba(99, 102, 241, 0.4)',
  },
  {
    id: 'industrial',
    title: '⚡ Warehouse Pro / Industrial',
    badge: 'Kho vận kỹ thuật',
    desc: 'Tương phản cao đen - vàng cam, font monospace, nút bấm to cho máy quét.',
    color: '#f59e0b',
    previewBorder: '1px solid rgba(245, 158, 11, 0.5)',
  },
];

export default function ThemeSwitcher() {
  const [currentTheme, setCurrentTheme] = useState<UiTheme>('glass');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('my_qr_theme') as UiTheme;
      if (saved && (saved === 'glass' || saved === 'dashboard' || saved === 'industrial')) {
        setCurrentTheme(saved);
        document.documentElement.setAttribute('data-theme', saved);
      } else {
        document.documentElement.setAttribute('data-theme', 'glass');
      }
    } catch {
      document.documentElement.setAttribute('data-theme', 'glass');
    }
  }, []);

  const handleSelectTheme = (theme: UiTheme) => {
    setCurrentTheme(theme);
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('my_qr_theme', theme);
    } catch {}
    setIsOpen(false);
  };

  return (
    <>
      {/* Nút Floating nổi ở góc phải màn hình để chuyển đổi nhanh mọi lúc */}
      <div
        style={{
          position: 'fixed',
          bottom: 76,
          right: 14,
          zIndex: 99,
        }}
      >
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'rgba(15, 23, 42, 0.92)',
            color: '#f8fafc',
            border: '1px solid rgba(255, 255, 255, 0.22)',
            borderRadius: 24,
            padding: '7px 14px',
            fontSize: '0.78rem',
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            backdropFilter: 'blur(12px)',
            transition: 'all 0.2s ease',
          }}
          title="Chọn kiểu giao diện UI"
        >
          <span>🎨</span>
          <span>Đổi Style UI</span>
          <span
            style={{
              fontSize: '0.68rem',
              padding: '1px 6px',
              borderRadius: 10,
              background:
                currentTheme === 'glass'
                  ? '#3b82f6'
                  : currentTheme === 'dashboard'
                  ? '#6366f1'
                  : '#f59e0b',
              color: currentTheme === 'industrial' ? '#000' : '#fff',
              fontWeight: 800,
            }}
          >
            {currentTheme === 'glass'
              ? 'Glass'
              : currentTheme === 'dashboard'
              ? 'SaaS'
              : 'Warehouse'}
          </span>
        </button>
      </div>

      {/* Popover / Modal chọn giao diện */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setIsOpen(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 440,
              background: '#0f172a',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 18,
              padding: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              boxShadow: '0 16px 40px rgba(0,0,0,0.8)',
              animation: 'slideUp 0.2s ease-out',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
                  🎨 Chọn Style Giao Diện
                </h3>
                <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '3px 0 0' }}>
                  Chỉ đổi màu sắc & bố cục, không ảnh hưởng dữ liệu hay camera
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  fontSize: '1.2rem',
                  cursor: 'pointer',
                  padding: 4,
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {THEME_OPTIONS.map((opt) => {
                const isSelected = currentTheme === opt.id;
                return (
                  <div
                    key={opt.id}
                    onClick={() => handleSelectTheme(opt.id)}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 12,
                      cursor: 'pointer',
                      border: isSelected ? `2px solid ${opt.color}` : '1px solid rgba(255,255,255,0.08)',
                      background: isSelected ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.9rem', color: isSelected ? opt.color : '#f8fafc' }}>
                        {opt.title}
                      </span>
                      <span
                        style={{
                          fontSize: '0.68rem',
                          padding: '2px 8px',
                          borderRadius: 12,
                          background: isSelected ? opt.color : 'rgba(255,255,255,0.1)',
                          color: isSelected && opt.id === 'industrial' ? '#000' : '#fff',
                          fontWeight: 700,
                        }}
                      >
                        {isSelected ? '✓ Đang dùng' : opt.badge}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0, lineHeight: 1.4 }}>
                      {opt.desc}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
