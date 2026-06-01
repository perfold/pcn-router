import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";

function WaypointItem({ wp, index, total, onRemove, provided }) {
  const dot = index === 0 ? "🟢" : index === total - 1 ? "🔴" : "⚫";

  return (
    <div
      ref={provided.innerRef}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 0",
        cursor: "grab",
        ...provided.draggableProps.style,
      }}
    >
      <span style={{ fontSize: 12, color: "#9ca3af" }}>⠿</span>

      <span>{dot}</span>
      <span
        style={{
          flex: 1,
          fontSize: 13,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {wp.label}
      </span>
      {/* remove button */}
      <button
        onClick={() => onRemove(wp.id)}
        style={{
          fontSize: 11,
          color: "#9ca3af",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}

export default function WaypointList({ waypoints, onReorder, onRemove }) {
  function handleDragEnd(result) {
    if (!result.destination) return;
    if (result.destination.index === result.source.index) return;

    const reordered = [...waypoints];
    reordered.splice(
      result.destination.index,
      0,
      reordered.splice(result.source.index, 1)[0],
    );
    onReorder(reordered);
  }

  if (waypoints.length === 0) return null;

  return (
    <div>
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="waypoints">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps}>
              {waypoints.map((wp, i) => (
                <Draggable key={wp.id} draggableId={wp.id} index={i}>
                  {(provided) => (
                    <WaypointItem
                      wp={wp}
                      index={i}
                      total={waypoints.length}
                      onRemove={onRemove}
                      provided={provided}
                    />
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    </div>
  );
}
