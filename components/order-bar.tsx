"use client"

import { useState } from "react"
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import {
  restrictToVerticalAxis,
  restrictToParentElement,
} from "@dnd-kit/modifiers"
import { CSS } from "@dnd-kit/utilities"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"
import { Toggle } from "@/components/ui/toggle"
import { ChevronUp, ChevronDown } from "lucide-react"

type Item = {
  id: string
  content: string | JSX.Element
  toggled?: boolean
}

type OrderBarProps = {
  items: Item[]
  onReorder?: (newOrder: Item[]) => void
  onToggle?: (id: string) => void
  highlightError?: boolean
}

type SortableItemProps = {
  id: string
  content: string | JSX.Element
  toggled: boolean
  onToggle: (id: string) => void
  isFirst: boolean
  isLast: boolean
}

function SortableItem({ id, content, toggled, onToggle, isFirst, isLast }: SortableItemProps) {
  const [isHovered, setIsHovered] = useState(false)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const showTopArrow = isHovered && !isFirst
  const showBottomArrow = isHovered && !isLast

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      className={cn("relative", isDragging && "opacity-0")}
      layout={!isDragging}
      layoutId={!isDragging ? id : undefined}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      animate={{
        marginTop: showTopArrow ? 8 : 0,
        marginBottom: showBottomArrow ? 8 : 0,
      }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      {...attributes}
      {...listeners}
    >
      {/* Top arrow indicator */}
      <AnimatePresence>
        {showTopArrow && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, y: [0, -3, 0] }}
            exit={{ opacity: 0 }}
            transition={{ 
              opacity: { duration: 0.15 },
              y: { duration: 0.6, repeat: Infinity, ease: "easeInOut" }
            }}
            className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10 pointer-events-none"
          >
            <ChevronUp className="w-4 h-4 text-muted-foreground" strokeWidth={3} />
          </motion.div>
        )}
      </AnimatePresence>

      <Toggle
        pressed={toggled}
        onPressedChange={() => onToggle(id)}
        variant="outline"
        className={cn(
          "w-12 h-12 p-0 rounded-lg border shadow-sm transition-colors",
          "hover:bg-neutral-400 dark:hover:bg-neutral-700",
          toggled && "bg-accent text-accent-foreground"
        )}
      >
        {content}
      </Toggle>

      {/* Bottom arrow indicator */}
      <AnimatePresence>
        {showBottomArrow && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, y: [0, 3, 0] }}
            exit={{ opacity: 0 }}
            transition={{ 
              opacity: { duration: 0.15 },
              y: { duration: 0.6, repeat: Infinity, ease: "easeInOut" }
            }}
            className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 z-10 pointer-events-none"
          >
            <ChevronDown className="w-4 h-4 text-muted-foreground" strokeWidth={3} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export default function OrderBar({ items: initialItems, onReorder, onToggle, highlightError }: OrderBarProps) {

  const handleToggle = (id: string) => {
    onToggle?.(id);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
      const oldIndex = initialItems.findIndex((i) => i.id === active.id);
      const newIndex = initialItems.findIndex((i) => i.id === over.id);
      const newItems = arrayMove(initialItems, oldIndex, newIndex);
      onReorder?.(newItems);
    }
  };

  return (
    <div className={cn(
      "bg-background p-2 pl-1 pr-1 border rounded-xl shadow-lg z-50 transition-all duration-300",
      highlightError && "bg-foreground/20 dark:bg-foreground/30 border-foreground/50"
    )}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      >
        <SortableContext items={initialItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2">
            {initialItems.map((item, index) => (
              <SortableItem
                key={item.id}
                id={item.id}
                content={item.content}
                toggled={!!item.toggled}
                onToggle={handleToggle}
                isFirst={index === 0}
                isLast={index === initialItems.length - 1}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}