import React from 'react';
import ReactDOM from 'react-dom';
import axios from 'axios';
import uuid from 'uuid/v4';

class Response extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      inputs: [''],
      outputs: [''],
    };
  }
    
    send = (event) => {
      console.log('send data:');
      console.log(this.state);
      axios.post(`http://localhost:3001/bcr/update`, this.state);
    }
    
    handleTextChange = (event, name, i) => {
      const data = this.state[name].slice();
      data[i] = event.target.value;
      this.setState({[name]: data});
      console.log(name, this.state[name][i]);
    };

    handleAddButtonClick = (event, name) => {
      console.log(`more ${name}!`);
    }
    
    render() {
      return (
        <div>
          <TextBoxes
            contentClass={Input}
            onChange={(event, i) => this.handleTextChange(event, 'inputs', i)}
            values={this.state.inputs}
            onAddButtonClick={(event) => this.handleAddButtonClick(event, 'inputs')}
          ></TextBoxes>
          <TextBoxes
            contentClass={Output}
            onChange={(event, i) => this.handleTextChange(event, 'outputs', i)}
            values={this.state.outputs}
            onAddButtonClick={(event) => this.handleAddButtonClick(event, 'outputs')}
          ></TextBoxes>
          <Options></Options>
          <SaveButton onClick={this.send}></SaveButton>
        </div>
      );
    }
}


class Input extends React.Component {
  render() {
    return (
      <input type="text" onInput={this.props.onChange}></input>
    )
  }
}

class Output extends React.Component {
  render() {
    return (
      <textarea onChange={this.props.onChange}></textarea>
    );
  }
}

class AddButton extends React.Component {
  render() {
    return (
      <button onClick={this.props.onClick}>Add</button>
    );
  }
}


class TextBoxes extends React.Component {
  render() {
    return (
      <div>
        <ul>
          {
            Object.keys(this.props.values).map((_, i) =>
              <this.props.contentClass onChange={
                (event) => this.props.onChange(event, i)
              } />
            )
          }
        </ul>
        <AddButton onClick={this.props.onAddButtonClick} />
      </div>
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

class Responses extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      responses: [null], // list of keys?
    };
  }
  
  render() {
    return (
      this.state.responses.map(
        (_, i) => <Response></Response> // TODO: use UUID for key
      )
    );
  }
}

class App extends React.Component {
  handleAddButtonClick = (event) => {
    console.log('more responses!');
  }

  render() {
    return (
      <div>
        <header>
          <p>カスタムレスポンス</p>
        </header>
        <Responses></Responses>
        <AddButton onClick={this.handleAddButtonClick}></AddButton>
      </div>
    );
  }
}
                            
ReactDOM.render(<App />, document.getElementById('root'));
                            
                            