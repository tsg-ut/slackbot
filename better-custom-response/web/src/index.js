import React from 'react';
import ReactDOM from 'react-dom';
import axios from 'axios';
import uuid from 'uuid/v4';


class TextBoxContent {
  constructor(text=null) {
    this.id = uuid();
    this.text = text;
  }
}

class Response extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      id: this.props.id,
      inputs: [new TextBoxContent()],
      outputs: [new TextBoxContent()],
    };
  }
    
  send = (event) => {
    console.log('send data:');
    console.log(this.state);
    axios.post(`http://localhost:3001/bcr/update`, this.state);
  }
  
  handleTextChange = (event, name, i) => {
    const data = this.state[name].slice();
    data[i].text = event.target.value;
    this.setState({[name]: data});
    console.log(name, this.state[name][i].text);
  };

  handleAddButtonClick = (event, name) => {
    const data = this.state[name].slice();
    data.push(new TextBoxContent());
    this.setState({[name]: data});
  }

  componentDidMount = () => {
    if (this.props.initialResponse) {
      this.setState(this.props.initialResponse);
    }
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
      <li>
        <input type="text" onInput={this.props.onChange} defaultValue={this.props.value.text}></input>
      </li>
    )
  }
}

class Output extends React.Component {
  render() {
    return (
      <li>
        <textarea onChange={this.props.onChange} defaultValue={this.props.value.text}></textarea>
      </li>
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
            this.props.values.map((value, i) =>
              <this.props.contentClass
                key={value.id}
                onChange={
                  (event) => this.props.onChange(event, i)
                }
                value={value}
              />
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
      responseIDs: [],
      initialResponses: null,
    };
  }

  componentDidMount = async () => {
    const res = await fetch('http://localhost:3001/bcr/list');
    if (!res.ok) {
      throw new Error(`fetch error ${res.status} ${res.statusText}`);
    }
    const responses = await res.json();
    console.log(responses);
    if (responses.length === 0) {
      this.setState({responseIDs: [uuid()], initialResponses: new Map()});
    } else {
      this.setState({
        responseIDs: responses.map(({id}) => id),
        initialResponses: new Map(responses.map(r => [r.id, r])),
      });
    }
  }

  handleAddButtonClick = (event) => {
    const responseIDs = this.state.responseIDs;
    responseIDs.push(uuid());
    this.setState({responseIDs: responseIDs});
  }
  
  render() {
    return (
      <div>
        {this.state.responseIDs.map(
          (id, i) => 
            <Response
              key={id}
              id={id}
              initialResponse={this.state.initialResponses.get(id)}
              onClick={this.handleAddButtonClick}
            ></Response>
        )}
        <AddButton onClick={this.handleAddButtonClick}></AddButton>
      </div>
    );
  }
}

class App extends React.Component {

  render() {
    return (
      <div>
        <header>
          <p>カスタムレスポンス</p>
        </header>
        <Responses></Responses>
      </div>
    );
  }
}
                            
ReactDOM.render(<App />, document.getElementById('root'));
                            
                            