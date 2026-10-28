import React from 'react';
import { Tooltip } from '@blueprintjs/core';
import { useAppContext } from '../../AppContext';
import { findScript, launchScript } from '../scriptActions';

const AdminScriptLink = ({ name }) => {
  const context = useAppContext();
  const script = findScript(context.state.scripts, `${name} (Admin Only)`);
  if (!script) {
    return <Tooltip content={`${name} is not available in the loaded script list.`}>
      <span aria-disabled="true" tabIndex={0}>{name}</span>
    </Tooltip>;
  }
  return <Tooltip content={`Open ${name}. Save changed settings before running it.`}>
    <a href={`/webclient/script_ui/${script.id}`} aria-label={`Open ${name} script`}
      onClick={(event) => { event.preventDefault(); launchScript(script, context); }}>
      {name}
    </a>
  </Tooltip>;
};

export default AdminScriptLink;
