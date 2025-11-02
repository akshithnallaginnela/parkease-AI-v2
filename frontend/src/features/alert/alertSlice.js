import { createSlice } from '@reduxjs/toolkit';

const initialState = [];

const alertSlice = createSlice({
  name: 'alert',
  initialState,
  reducers: {
    setAlert: (state, action) => {
      state.push(action.payload);
    },
    removeAlert: (state, action) => {
      return state.filter((alert) => alert.id !== action.payload);
    },
  },
});

export const { setAlert, removeAlert } = alertSlice.actions;

export const showAlert = (msg, alertType, timeout = 5000) => (dispatch) => {
  const id = Math.random().toString(36).substr(2, 9);
  dispatch(setAlert({ msg, alertType, id }));

  setTimeout(() => dispatch(removeAlert(id)), timeout);
};

export default alertSlice.reducer;
