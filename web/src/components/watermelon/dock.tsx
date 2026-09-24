// Vendored from https://registry.watermelon.sh/r/dock.json (2026-09-24). Edits: hugeicons -> lucide, local cn helper. Extended below via props in Dock use.
'use client';

import React, { useState, type FC } from 'react';
import { motion, type Transition } from 'motion/react';

import { Home, Search, Plus, Bell, Settings } from 'lucide-react';
const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export interface DockItem {
  id: number | string;
  Icon: React.ElementType;
  label?: string;
}

interface DockProps {
  items?: DockItem[];
  activeId?: number | string | null;
  onSelect?: (id: number | string) => void;
}

const DEFAULT_DOCK_ITEMS: DockItem[] = [
  { id: 1, Icon: Home },
  { id: 2, Icon: Search },
  { id: 3, Icon: Plus },
  { id: 4, Icon: Bell },
  { id: 5, Icon: Settings },
];

const dockSpring: Transition = {
  stiffness: 300,
  damping: 22,
  mass: 0.7,
};

export const Dock: FC<DockProps> = ({ items, activeId, onSelect }) => {
  const dockItems = items ?? DEFAULT_DOCK_ITEMS;
  const [localSelected, setSelected] = useState<number | string | null>(null);
  const selected = activeId !== undefined ? activeId : localSelected;
  const [animateSelected, setAnimateSelected] = useState<number | string | null>(null);

  const handleClick = (id: number | string) => {
    onSelect?.(id);
    setSelected(id);
    setAnimateSelected(id);
    setTimeout(() => {
      setAnimateSelected(null);
    }, 200);
  };

  return (
    <div className="flex w-full flex-col items-center justify-center">
      <motion.div
        layout
        transition={dockSpring}
        className="relative flex items-end gap-3.5 rounded-3xl border-[1.5px] border-[#E5E5E9] bg-white px-3 py-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        {dockItems.map((item) => (
          <motion.div
            key={item.id}
            role="button"
            aria-label={item.label}
            className="relative"
            onClick={() => handleClick(item.id)}
            style={{
              transformOrigin: 'bottom',
            }}
            initial={{
              scale: 1,
            }}
            whileHover={{
              y: -4,
            }}
            animate={{
              scale: animateSelected === item.id ? 1.3 : 1,
              y: animateSelected === item.id ? -6 : 0,
            }}
            transition={{
              type: 'spring',
              stiffness: 550,
              damping: 15,
              mass: 1.1,
            }}
          >
            <motion.div className="cursor-pointer rounded-xl bg-[#F4F4FB] p-2.5 dark:bg-zinc-800">
              <item.Icon
                className={cn(
                  'size-6 text-zinc-500 transition-all duration-200 dark:text-zinc-400',
                  selected === item.id && 'text-rose-500 dark:text-rose-400',
                )}
              />
            </motion.div>

            <motion.div
              className={cn(
                'absolute mt-px flex w-full items-center justify-center opacity-0 transition-opacity duration-400 will-change-transform',
                selected === item.id && 'opacity-100',
              )}
            >
              <div
                className="rounded-full bg-zinc-200 dark:bg-zinc-700"
                style={{
                  width: 4,
                  height: 4,
                }}
              />
            </motion.div>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
};
