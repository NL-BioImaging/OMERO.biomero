import React from "react";
import { render, screen } from "@testing-library/react";
import { ImageGridCard, ImageListRow } from "./WorkflowInput";

jest.mock("@blueprintjs/core", () => {
  const Container = ({ children }) => <div>{children}</div>;
  return {
    Card: Container,
    Switch: ({ children, checked, onChange, disabled }) => (
      <label>
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          disabled={disabled}
        />
        {children}
      </label>
    ),
    Tag: Container,
    Tooltip: ({ children, content }) => (
      <div>
        {children}
        <div data-testid="tooltip-content">{content}</div>
      </div>
    ),
    Spinner: () => null,
    SpinnerSize: { SMALL: "small" },
  };
});

const image = { id: 3207, name: "Cell-Granules_IMPORTED.tif" };
const datasetInfo = { id: 54, data: "My_Results" };
const commonProps = {
  image,
  isSelected: true,
  isDisabled: false,
  thumbnail: "/thumbnail/3207",
  apiLoading: false,
  datasetInfo,
  onToggle: jest.fn(),
  onVisible: jest.fn(),
};

test("shows the image ID directly in image-list rows", () => {
  render(<ImageListRow {...commonProps} />);

  expect(screen.getByText("ID: 3207")).toBeInTheDocument();
  expect(screen.getByText("My_Results (ID: 54)")).toBeInTheDocument();
});

test("includes the image ID in thumbnail-grid hover details", () => {
  render(<ImageGridCard {...commonProps} />);

  expect(screen.getByText("Image ID: 3207")).toBeInTheDocument();
  expect(screen.getByText("My_Results (ID: 54)")).toBeInTheDocument();
});
