import React from 'react';
import { Icon, Tooltip } from '@blueprintjs/core';

const DocumentationLink = ({ href, label, children }) => (
  <Tooltip content={`${label} (opens in a new tab)`}>
    <a href={href} target="_blank" rel="noopener noreferrer"
      aria-label={label} className="bp5-button bp5-minimal bp5-small inline-flex items-center gap-1">
      <Icon icon="book" size={14} />{children}
    </a>
  </Tooltip>
);

export default DocumentationLink;
