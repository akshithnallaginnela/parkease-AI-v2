import React, { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { removeAlert } from '../../features/alert/alertSlice';
import { Snackbar, Alert as MuiAlert } from '@mui/material';

const Alert = () => {
  const dispatch = useDispatch();
  const alerts = useSelector((state) => state.alert);

  const handleClose = (id) => {
    dispatch(removeAlert(id));
  };

  return (
    <>
      {alerts.map((alert) => (
        <Snackbar
          key={alert.id}
          open={true}
          autoHideDuration={6000}
          onClose={() => handleClose(alert.id)}
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        >
          <MuiAlert
            onClose={() => handleClose(alert.id)}
            severity={alert.alertType}
            elevation={6}
            variant="filled"
          >
            {alert.msg}
          </MuiAlert>
        </Snackbar>
      ))}
    </>
  );
};

export default Alert;
