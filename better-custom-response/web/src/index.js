import React from 'react';
import ReactDOM from 'react-dom';
import axios from 'axios';

class Response extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      input: null,
      output: null,
    };
  }

  send = (event) => {
    console.log('send data:');
    console.log(this.state);
    axios.post(`http://localhost:${process.env.PORT}/bcr/update`, this.state);
  }

  handleTextChange = (event, type) => {
    this.setState({[type]: event.target.value});
    console.log(type, this.state[type]);
  };

  render() {
    return (
      <div>
        <Inputs onChange={(event) => this.handleTextChange(event, 'input')}></Inputs>
        <Outputs onChange={(event) => this.handleTextChange(event, 'output')}></Outputs>
        <Options></Options>
        <SaveButton onClick={this.send}></SaveButton>
      </div>
    );
  }
}

class Inputs extends React.Component {

  render() {
    return (
      <input type="text" onInput={this.props.onChange}></input>
    );
  }
}

class Outputs extends React.Component {
  render() {
    return (
      <textarea onChange={this.props.onChange}></textarea>
    );
  }
}
class Options extends React.Component {
  render() {
    return (
      <div>
        <Option></Option>
      </div>
    );
  }
}
class Option extends React.Component {
  render() {
    return (
      <input type="checkbox" ></input>
    );
  }
}

class SaveButton extends React.Component {
  render() {
    return (
      <button onClick={this.props.onClick}>save</button>
    );
  }
}

const App = () => {
  return (
    <div>
      <header>
        <p>カスタムレスポンス</p>
      </header>
      <Response></Response>
    </div>
  );
}

ReactDOM.render(<App />, document.getElementById('root'));

