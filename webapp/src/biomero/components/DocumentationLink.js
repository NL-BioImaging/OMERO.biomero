import React from 'react';
import { AnchorButton, Tooltip } from '@blueprintjs/core';

const DocumentationLink = ({ href, label, children }) => (
  <Tooltip content={`${label} (opens in a new tab)`}>
    <AnchorButton href={href} target="_blank" rel="noopener noreferrer"
      aria-label={label} icon="book" text={children}
      outlined={!!children} intent={children ? 'primary' : undefined}
      minimal={!children} small={!children} />
  </Tooltip>
);

export default DocumentationLink;
