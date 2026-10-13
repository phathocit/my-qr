'use client';

import React, { useState, useEffect } from 'react';

export type UiTheme = 'glass' | 'dashboard' | 'industrial' | 'apple';

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
    id: 'apple',
    title: '🍎 4. Apple Liquid Glass',
    badge: 'Trend VisionOS / iOS 18',
    desc: 'Kính acrylic mờ siêu thực, viền khúc xạ ánh sáng (Specular Highlight), bo góc mềm Squircle sang trọng.',
    color: '#0a84ff',
    previewBorder: '1px solid rgba(10, 132, 255, 0.4)',
  },
  {
    id: 'glass',
    title: '💎 1. Sleek Glassmorphism',
    badge: 'Linear / Vercel',
    desc: 'Kính mờ Linear/Vercel, nền đen sâu, viền phản quang phát sáng nhẹ.',
    color: '#3b82f6',
    previewBorder: '1px solid rgba(59, 130, 246, 0.4)',
  },
  {
    id: 'dashboard',
    title: '📊 2. Full-Width SaaS Dashboard',
    badge: 'Tối ưu PC/Laptop',
    desc: 'Mở rộng toàn màn hình máy tính (1200px), thẻ gọn gàng phong cách ERP.',
    color: '#6366f1',
    previewBorder: '1px solid rgba(99, 102, 241, 0.4)',
  },
  {
    id: 'industrial',
    title: '⚡ 3. Warehouse Pro / Industrial',
    badge: 'Kho vận kỹ thuật',
    desc: 'Tương phản cao đen - vàng cam, font monospace, nút bấm to cho máy quét.',
    color: '#f59e0b',
    previewBorder: '1px solid rgba(245, 158, 11, 0.5)',
  },
];

export default function ThemeSwitcher() {
  const [currentTheme, setCurrentTheme] = useState<UiTheme>('apple');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('my_qr_theme') as UiTheme;
      const validThemes: UiTheme[] = ['apple', 'glass', 'dashboard', 'industrial'];
      if (saved && validThemes.includes(saved)) {
        setCurrentTheme(saved);
        document.documentElement.setAttribute('data-theme', saved);
      } else {
        // Mặc định trải nghiệm ngay Option 4 Apple Glass
        setCurrentTheme('apple');
        document.documentElement.setAttribute('data-theme', 'apple');
      }
    } catch {
      document.documentElement.setAttribute('data-theme', 'apple');
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

  const getThemeShortLabel = (theme: UiTheme) => {
    switch (theme) {
      case 'apple': return 'Apple Glass';
      case 'glass': return 'Glass';
      case 'dashboard': return 'SaaS';
      case 'industrial': return 'Warehouse';
      default: return 'Theme';
    }
  };

  const currentThemeObj = THEME_OPTIONS.find((t) => t.id === currentTheme) || THEME_OPTIONS[0];

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
            background: 'rgba(15, 23, 42, 0.94)',
            color: '#f8fafc',
            border: `1px solid ${currentThemeObj.color}88`,
            borderRadius: 24,
            padding: '7px 14px',
            fontSize: '0.78rem',
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: `0 8px 24px rgba(0,0,0,0.6), 0 0 12px ${currentThemeObj.color}33`,
            backdropFilter: 'blur(12px)',
            transition: 'all 0.2s ease',
          }}
          title="Chọn kiểu giao diện UI"
        >
          <span>🎨</span>
          <span>Style UI</span>
          <span
            style={{
              fontSize: '0.68rem',
              padding: '2px 8px',
              borderRadius: 10,
              background: currentThemeObj.color,
              color: currentTheme === 'industrial' ? '#000' : '#fff',
              fontWeight: 800,
            }}
          >
            {getThemeShortLabel(currentTheme)}
          </span>
        </button>
      </div>

      {/* Popover / Modal chọn giao diện */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            backdropFilter: 'blur(8px)',
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
              maxWidth: 460,
              maxHeight: '90vh',
              overflowY: 'auto',
              background: '#0d1117',
              border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: 20,
              padding: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              boxShadow: '0 20px 50px rgba(0,0,0,0.85)',
              animation: 'slideUp 0.2s ease-out',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 10 }}>
              <div>
                <h3 style={{ fontSize: '1.02rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                  🎨 Chọn Style Giao Diện
                </h3>
                <p style={{ fontSize: '0.74rem', color: '#94a3b8', margin: '3px 0 0' }}>
                  Chỉ đổi màu sắc & hiệu ứng kính, không ảnh hưởng logic/camera
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  fontSize: '1.3rem',
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
                      borderRadius: 14,
                      cursor: 'pointer',
                      border: isSelected ? `2px solid ${opt.color}` : '1px solid rgba(255,255,255,0.08)',
                      background: isSelected ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)',
                      transition: 'all 0.18s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 800, fontSize: '0.92rem', color: isSelected ? opt.color : '#f8fafc' }}>
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
                    <p style={{ fontSize: '0.74rem', color: '#94a3b8', margin: 0, lineHeight: 1.4 }}>
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
