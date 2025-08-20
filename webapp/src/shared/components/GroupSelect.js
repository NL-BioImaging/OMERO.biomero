import React from "react";
import { Button, MenuItem } from "@blueprintjs/core";
import { Select } from "@blueprintjs/select";
import { useAppContext } from "../../AppContext";

const GroupSelect = () => {
  const { state } = useAppContext();
  const options = state.user.groups;

  // Initialize selectedOption based on the active_group_id
  const [selectedOption, setSelectedOption] = React.useState(() => {
    return state.user.groups.find(
      (group) => group.id === state.user.active_group_id
    );
  });

  React.useEffect(() => {
    // Update selectedOption when active_group_id changes
    const activeGroup = state.user.groups.find(
      (group) => group.id === state.user.active_group_id
    );
    setSelectedOption(activeGroup);
  }, [state.user.active_group_id, state.user.groups]);

  const onSelect = (item) => {
    return;
  };

  const renderOption = (item, { handleClick, handleFocus, modifiers }) => {
    if (!modifiers.matchesPredicate) {
      return null;
    }
    return (
      <MenuItem
        active={modifiers.active}
        disabled={modifiers.disabled}
        key={item.id}
        onClick={handleClick}
        onFocus={handleFocus}
        roleStructure="listoption"
        text={item.name}
        className="text-sm"
      />
    );
  };

  const handleItemSelect = (item) => {
    // Change the active group and navigate back to the current page (preserve base path + tab)
    const currentPath = `${window.location.pathname}${window.location.search}` || "/";
    // Fallback: if no tab param present, keep existing behavior (default to import)
    const hasTab = /[?&]tab=/.test(currentPath);
    const targetPath = hasTab ? currentPath : `${currentPath}${currentPath.includes("?") ? "&" : "?"}tab=import`;
    const redirect = `/webclient/active_group/?active_group=${item.id}&url=${encodeURIComponent(targetPath)}`;
    window.location.href = redirect;
    if (onSelect) {
      onSelect(item);
      setSelectedOption(item);
    }
  };

  const currentGroupName = selectedOption?.name || "Select an option...";

  return (
    <Select
      items={options}
      itemRenderer={renderOption}
      noResults={
        <MenuItem
          disabled={true}
          text="No results."
          roleStructure="listoption"
        />
      }
      onItemSelect={handleItemSelect}
      filterable={false}
      activeItem={selectedOption}
    >
      <Button
        text={currentGroupName}
        rightIcon="double-caret-vertical"
        placeholder="Select an option"
      />
    </Select>
  );
};

export default GroupSelect;
